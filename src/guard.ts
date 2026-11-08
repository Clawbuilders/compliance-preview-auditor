/**
 * The in-browser half of the SSRF checks. `page.goto` follows redirects and the page loads whatever it likes, so every request
 * the browser makes passes through this guard (puppeteer request interception):
 *
 * - data:, blob: and about: URLs never leave the browser and are always allowed; any other non-http(s) scheme is blocked.
 * - Subresources (scripts, images, XHR, ...) are blocked when their host is an IP literal (any, public or not) or a
 *   single-label/internal name. No DNS lookup is made for them, to keep page loads fast.
 * - Navigations (the main frame, its redirects, and iframes) get the full URL check including DNS resolution. The allow-list
 *   applies to main-frame navigations only, so an embedded third-party iframe is not refused for being off-list.
 *
 * DNS answers are cached per host for the run (see `cachedResolver`). Cloudflare's network remains the outer boundary.
 */
import { isInternalName, isIpLiteral, validateTargetUrl, type Resolver } from "./url";

export type RequestKind = "main-frame-navigation" | "frame-navigation" | "subresource";
export type GuardDecision = { allow: true } | { allow: false; reason: string };

const ALLOW: GuardDecision = { allow: true };
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

export function createRequestGuard(opts: { allowedHosts?: string; resolve: Resolver }) {
  return async (rawUrl: string, kind: RequestKind): Promise<GuardDecision> => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return { allow: false, reason: "malformed URL" };
    }
    if (LOCAL_SCHEMES.has(u.protocol)) return ALLOW;
    if (u.protocol !== "http:" && u.protocol !== "https:") return { allow: false, reason: `${u.protocol} URLs are not loaded` };

    if (kind === "subresource") {
      if (isIpLiteral(u.hostname)) return { allow: false, reason: "IP-literal hosts are not loaded" };
      if (isInternalName(u.hostname)) return { allow: false, reason: "single-label and internal host names are not loaded" };
      return ALLOW;
    }
    const check = await validateTargetUrl(rawUrl, kind === "main-frame-navigation" ? opts.allowedHosts : undefined, opts.resolve);
    return check.ok ? ALLOW : { allow: false, reason: check.reason };
  };
}
