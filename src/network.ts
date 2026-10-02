/** Which third parties did the page talk to? Pure functions over the request log recorded before any consent interaction. */

export interface ThirdParty {
  host: string;
  requests: number;
  /** Set when the host is a well-known analytics/advertising tracker. */
  tracker?: string;
}

// Public suffixes with more than one label. A short list is enough for an audit aid; unknown suffixes fall back to two labels.
const MULTI_PART = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.mx", "com.cn", "co.za", "com.sg", "co.kr", "com.tr", "com.ar"]);

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  const labels = h.split(".");
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_PART.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

const TRACKERS: [string, RegExp][] = [
  ["google-analytics", /(^|\.)(google-analytics\.com|analytics\.google\.com)$/],
  ["google-tag-manager", /(^|\.)googletagmanager\.com$/],
  ["doubleclick", /(^|\.)doubleclick\.net$/],
  ["facebook", /(^|\.)(connect\.facebook\.net|facebook\.com)$/],
  ["posthog", /(^|\.)posthog\.com$/],
  ["hotjar", /(^|\.)hotjar\.(com|io)$/],
  ["segment", /(^|\.)segment\.(com|io)$/],
  ["mixpanel", /(^|\.)mixpanel\.com$/],
  ["amplitude", /(^|\.)amplitude\.com$/],
  ["linkedin", /(^|\.)(px\.ads\.linkedin\.com|snap\.licdn\.com)$/],
  ["tiktok", /(^|\.)analytics\.tiktok\.com$/],
  ["microsoft-clarity", /(^|\.)clarity\.ms$/],
];

export function classifyTracker(host: string): string | undefined {
  return TRACKERS.find(([, re]) => re.test(host))?.[0];
}

export function thirdPartyRequests(requests: { url: string }[], pageUrl: string): ThirdParty[] {
  let pageSite: string;
  try {
    pageSite = registrableDomain(new URL(pageUrl).hostname);
  } catch {
    return [];
  }
  const counts = new Map<string, number>();
  for (const r of requests) {
    let u: URL;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue; // data:, blob:, about: never leave the page
    const host = u.hostname.toLowerCase();
    if (registrableDomain(host) === pageSite) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([host, requests]): ThirdParty => ({ host, requests, tracker: classifyTracker(host) }))
    .map((t) => (t.tracker ? t : { host: t.host, requests: t.requests }))
    .sort((a, b) => Number(Boolean(b.tracker)) - Number(Boolean(a.tracker)) || a.host.localeCompare(b.host));
}
