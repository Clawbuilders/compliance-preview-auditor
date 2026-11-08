/** Which hosts did the page talk to? Pure functions over the request log recorded before any consent interaction. */
import { matchesHostList } from "./url";

export interface RecordedRequest {
  url: string;
  /** The auditor's request guard aborted it (internal address, IP literal, refused redirect). */
  blocked?: boolean;
}

export interface ThirdParty {
  host: string;
  requests: number;
  /** Set when the host is a well-known analytics/advertising tracker. */
  tracker?: string;
  /** How many of those requests the auditor blocked. Omitted when none were. */
  blocked?: number;
}

/**
 * Public suffixes with more than one label, including hosting platforms where every customer gets a subdomain (so
 * `pr-7.my-app.pages.dev` belongs to `my-app.pages.dev`, not to every Pages site). This approximates the Public Suffix List:
 * a short list is enough for an audit aid, and unknown suffixes fall back to the last two labels.
 */
const MULTI_PART = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.mx", "com.cn", "co.za", "com.sg", "co.kr", "com.tr", "com.ar",
  "pages.dev", "workers.dev", "github.io", "vercel.app", "netlify.app", "fly.dev", "herokuapp.com", "web.app", "firebaseapp.com", "onrender.com", "azurewebsites.net",
]);

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

/**
 * Split the request log into first parties and third parties. First party = the audited page's registrable domain (other
 * than the page's own host, which is not listed) or a host on `firstPartyHosts` (FIRST_PARTY_HOSTS: exact or `*.suffix`).
 * A well-known tracker host is always a third party, even if configured as first party.
 */
export function classifyRequests(requests: RecordedRequest[], pageUrl: string, firstPartyHosts: string[] = []): { firstParties: ThirdParty[]; thirdParties: ThirdParty[] } {
  let pageHost: string;
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return { firstParties: [], thirdParties: [] };
  }
  const pageSite = registrableDomain(pageHost);
  const counts = new Map<string, { requests: number; blocked: number }>();
  for (const r of requests) {
    let u: URL;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue; // data:, blob:, about: never leave the page
    const host = u.hostname.toLowerCase();
    if (host === pageHost) continue;
    const c = counts.get(host) ?? { requests: 0, blocked: 0 };
    c.requests++;
    if (r.blocked) c.blocked++;
    counts.set(host, c);
  }
  const firstParties: ThirdParty[] = [];
  const thirdParties: ThirdParty[] = [];
  for (const [host, c] of counts) {
    const tracker = classifyTracker(host);
    const row: ThirdParty = { host, requests: c.requests, ...(tracker ? { tracker } : {}), ...(c.blocked ? { blocked: c.blocked } : {}) };
    const first = !tracker && (registrableDomain(host) === pageSite || matchesHostList(host, firstPartyHosts));
    (first ? firstParties : thirdParties).push(row);
  }
  const order = (a: ThirdParty, b: ThirdParty) => Number(Boolean(b.tracker)) - Number(Boolean(a.tracker)) || a.host.localeCompare(b.host);
  return { firstParties: firstParties.sort(order), thirdParties: thirdParties.sort(order) };
}

/** Third parties only (see `classifyRequests`). */
export function thirdPartyRequests(requests: RecordedRequest[], pageUrl: string, firstPartyHosts: string[] = []): ThirdParty[] {
  return classifyRequests(requests, pageUrl, firstPartyHosts).thirdParties;
}
