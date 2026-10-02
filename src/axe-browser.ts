import type { Page } from "@cloudflare/puppeteer";
import axeSource from "axe-core/axe.min.js";
import { summarizeAxe, type AxeViolationSummary } from "./axe";

/**
 * Inject axe-core and run it with WCAG 2.0/2.1/2.2 A and AA rules. `page.evaluate(string)` goes through the DevTools
 * protocol, so a page's Content-Security-Policy cannot block the injection (a <script> tag would be).
 */
export async function runAxe(page: Page): Promise<AxeViolationSummary[]> {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    // @ts-expect-error `axe` is defined on the page by the injected source
    return await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
  });
  return summarizeAxe(results);
}
