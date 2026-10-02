import puppeteer from "@cloudflare/puppeteer";
import { runAxe } from "./axe-browser";
import { thirdPartyRequests } from "./network";
import type { AuditResult } from "./report";
import { classifyScreenshot, type AiBinding } from "./vision";

export interface AuditEnv {
  BROWSER: Fetcher;
  AI: AiBinding;
}

const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1500; // let late-firing trackers show up before we stop listening

/**
 * Load the page like a first-time visitor and touch NOTHING — no consent click — so the request log shows what the page does
 * before consent. Then run axe-core and look at one screenshot with Clef vision.
 */
export async function auditUrl(env: AuditEnv, url: URL): Promise<AuditResult> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const requests: { url: string }[] = [];
    page.on("request", (r) => requests.push({ url: r.url() }));

    try {
      await page.goto(url.href, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    } catch {
      // A chatty page may never go idle; what has loaded by now is still worth auditing.
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const finalUrl = page.url();
    const thirdParties = thirdPartyRequests([...requests], finalUrl); // snapshot before anything else runs
    const title = await page.title().catch(() => "");
    const violations = await runAxe(page);

    let vision: AuditResult["vision"] = null;
    let visionTier: AuditResult["visionTier"] = "unavailable";
    try {
      const shot = (await page.screenshot({ type: "jpeg", quality: 70 })) as Uint8Array;
      vision = await classifyScreenshot(env.AI, Buffer.from(shot).toString("base64"));
      visionTier = "clef";
    } catch {
      /* the report says the screenshot check was unavailable */
    }
    return { url: url.href, finalUrl, title, violations, thirdParties, vision, visionTier };
  } finally {
    await browser.close();
  }
}
