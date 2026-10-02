/**
 * Validate the URL a caller asks us to audit. An auditor that fetches arbitrary URLs is an SSRF primitive, so this is strict:
 * http(s) only, no credentials, no local/private/link-local targets, no IPv6 literals, and an optional allow-list.
 * (Browser Rendering runs on Cloudflare's network and cannot reach your private network anyway; this keeps the intent explicit.)
 */
export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const MAX_LENGTH = 2048;
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet"];

function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function isPrivateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

function matchesAllowList(host: string, allow: string): boolean {
  const entries = allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return entries.some((e) => (e.startsWith("*.") ? host.endsWith(e.slice(1)) && host.length > e.length - 1 : host === e));
}

export function validateTargetUrl(input: unknown, allowedHosts?: string): UrlCheck {
  if (typeof input !== "string" || !input.trim()) return { ok: false, reason: "A url is required." };
  const raw = input.trim();
  if (raw.length > MAX_LENGTH) return { ok: false, reason: `The url is longer than ${MAX_LENGTH} characters.` };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http and https URLs can be audited." };
  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are not allowed." };

  // The WHATWG parser already normalises integer/hex/octal IPv4 forms (2130706433, 0x7f000001) to dotted quads.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || host.includes(":")) return { ok: false, reason: "IPv6 literal addresses are not allowed; use a hostname." };
  const v4 = ipv4Octets(host);
  if (v4 && isPrivateIpv4(v4)) return { ok: false, reason: "Private, loopback and local network addresses cannot be audited." };
  if (host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s)) || host === "metadata.google.internal") {
    return { ok: false, reason: "Private, loopback and local network addresses cannot be audited." };
  }
  if (allowedHosts?.trim() && !matchesAllowList(host, allowedHosts)) return { ok: false, reason: "That host is not on this auditor's allow-list." };
  return { ok: true, url };
}
