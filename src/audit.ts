import puppeteer from "@cloudflare/puppeteer";
import { runAxe } from "./axe-browser";
import { AuditRefusedError } from "./errors";
import { createRequestGuard, type RequestKind } from "./guard";
import { classifyRequests, type RecordedRequest } from "./network";
import type { AuditResult } from "./report";
import { parseHostList, type Resolver } from "./url";
import { classifyScreenshot, type AiBinding } from "./vision";

export interface AuditEnv {
  BROWSER: Fetcher;
  AI: AiBinding;
  ALLOWED_HOSTS?: string;
  FIRST_PARTY_HOSTS?: string;
}

const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1500; // let late-firing trackers show up before we stop listening

/**
 * Load the page like a first-time visitor and touch NOTHING — no consent click — so the request log shows what the page does
 * before consent. Then run axe-core and look at one screenshot with Clef vision.
 *
 * Every request goes through the request guard (src/guard.ts): redirects and iframes are re-checked like the submitted URL,
 * and subresources aimed at IP literals or internal names are aborted. Aborted requests are still recorded, marked blocked.
 */
export async function auditUrl(env: AuditEnv, url: URL, resolve: Resolver): Promise<AuditResult> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const guard = createRequestGuard({ allowedHosts: env.ALLOWED_HOSTS, resolve });
    const requests: RecordedRequest[] = [];
    let refusedNavigation: { url: string; reason: string } | null = null;
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      const kind: RequestKind = !req.isNavigationRequest() ? "subresource" : req.frame() === page.mainFrame() ? "main-frame-navigation" : "frame-navigation";
      const decision = await guard(req.url(), kind).catch(() => ({ allow: false as const, reason: "the request could not be checked" }));
      requests.push({ url: req.url(), blocked: !decision.allow });
      if (decision.allow) {
        await req.continue().catch(() => {});
      } else {
        if (kind === "main-frame-navigation") refusedNavigation ??= { url: req.url(), reason: decision.reason };
        await req.abort("blockedbyclient").catch(() => {});
      }
    });

    try {
      await page.goto(url.href, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    } catch {
      // A chatty page may never go idle; what has loaded by now is still worth auditing.
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const refused = refusedNavigation as { url: string; reason: string } | null;
    if (refused) {
      let where = refused.url;
      try {
        where = new URL(refused.url).host;
      } catch {
        /* keep the raw URL */
      }
      throw new AuditRefusedError(`The page tried to navigate to ${where}, which cannot be audited: ${refused.reason}`);
    }

    const finalUrl = page.url();
    const { firstParties, thirdParties } = classifyRequests([...requests], finalUrl, parseHostList(env.FIRST_PARTY_HOSTS)); // snapshot before anything else runs
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
    return { url: url.href, finalUrl, title, violations, firstParties, thirdParties, vision, visionTier };
  } finally {
    await browser.close();
  }
}
