/** Errors the HTTP layer turns into specific status codes instead of a generic 502. */

/** The page tried to navigate (redirect, meta refresh, script) somewhere the auditor refuses to go. Maps to 400. */
export class AuditRefusedError extends Error {}

/**
 * Browser Rendering would not start a browser because an account limit was hit. On the Workers Free plan that is 3 concurrent
 * browsers, 1 new browser every 20 seconds and 10 browser-minutes per day. Maps to 429.
 */
export class BrowserLimitError extends Error {
  constructor(cause: string) {
    super(
      "Cloudflare Browser Rendering refused to start a browser because a plan limit was reached " +
        "(Workers Free: 3 concurrent browsers, 1 new browser every 20 seconds, 10 browser-minutes per day). " +
        `Wait and retry, or move to Workers Paid for higher limits. Details: ${cause}`,
    );
  }
}

/** `puppeteer.launch` reports limits as "Unable to create new browser: code: 429: message: ...". */
export function isBrowserLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /code:\s*429\b|\b429\b|rate.?limit|too many|limit (exceeded|reached)|quota|browser time/i.test(msg);
}
