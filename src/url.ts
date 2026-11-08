/**
 * Validate the URL a caller asks us to audit. An auditor that fetches arbitrary URLs is a server-side request forgery (SSRF)
 * primitive, so this is strict. A URL is refused when:
 *
 * - its scheme is not http or https, it embeds credentials, or it is longer than 2048 characters;
 * - its host is an IPv6 literal (any), or an IPv4 literal in a private, loopback, link-local (incl. 169.254.169.254 cloud
 *   metadata), carrier-grade NAT (100.64/10), "this network" (0/8), benchmarking, documentation, multicast or reserved range.
 *   The WHATWG URL parser first normalises integer, hex, octal and full-width-digit forms (2130706433, 0x7f000001,
 *   0177.0.0.1) to dotted quads, so those are caught too;
 * - its host is a single label (`localhost`, `metadata`, `instance-data`, `intranet`; a trailing dot is ignored) or ends in an
 *   internal suffix (`.localhost`, `.local`, `.localdomain`, `.internal`, `.intranet`, `.lan`, `.home`, `.home.arpa`, `.corp`);
 * - an allow-list is configured and the host is not on it;
 * - (for DNS names, in `validateTargetUrl`) any A or AAAA answer is a non-public address by the IPv4 rules above, or is
 *   IPv6 loopback, unspecified, IPv4-mapped (::ffff:0:0/96), NAT64, unique-local (fc00::/7), link-local, site-local,
 *   multicast, documentation, Teredo, 6to4 or anything outside global unicast (2000::/3). Resolution goes through
 *   DNS-over-HTTPS and fails closed: if the lookup fails or returns no address, the URL is refused.
 *
 * The browser resolves the name again when it navigates, so a DNS-rebinding host could still answer differently the second
 * time. These checks state intent and stop the easy cases; the outer boundary is Cloudflare's network: Browser Rendering runs
 * there and cannot reach your private network.
 */
export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Resolves a host name to its A and AAAA addresses. Throws when the lookup cannot be completed. */
export type Resolver = (host: string) => Promise<string[]>;

const MAX_LENGTH = 2048;
const INTERNAL_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home", ".home.arpa", ".corp"];
const PRIVATE_REASON = "Private, loopback and local network addresses cannot be audited.";

// ---------------------------------------------------------------------------------------------------------------- addresses

function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function isPublicIpv4([a, b, c]: number[]): boolean {
  return !(
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast and reserved
  );
}

/** Parses an IPv6 address (optionally bracketed, optionally ending in a dotted quad) into eight 16-bit groups. */
export function ipv6Groups(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, "").toLowerCase();
  if (s.includes("%")) s = s.slice(0, s.indexOf("%")); // zone id
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = ipv4Octets(v4[2]);
    if (!o) return null;
    s = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (p: string) => (p ? p.split(":") : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isPublicIpv6(g: number[]): boolean {
  if ((g[0] & 0xe000) !== 0x2000) return false; // only global unicast 2000::/3 (excludes ::1, ::, ::ffff:0:0/96, 64:ff9b::/96, fc00::/7, fe80::/10, fec0::/10, ff00::/8)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] === 0x0000) return false; // Teredo (embeds an IPv4 address)
  if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return false; // benchmarking
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) return false; // ORCHID
  if (g[0] === 0x2002) return false; // 6to4 (embeds an IPv4 address)
  return true;
}

/** True only for addresses that are publicly routable. Anything unparseable is not public. */
export function isPublicIp(ip: string): boolean {
  const v4 = ipv4Octets(ip.trim());
  if (v4) return isPublicIpv4(v4);
  const v6 = ipv6Groups(ip.trim());
  return v6 ? isPublicIpv6(v6) : false;
}

// --------------------------------------------------------------------------------------------------------------- host names

function normalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

export function isIpLiteral(host: string): boolean {
  const h = normalHost(host);
  return h.startsWith("[") || h.includes(":") || ipv4Octets(h) !== null;
}

/** Single-label names and internal suffixes: names that only mean something inside a private network. */
export function isInternalName(host: string): boolean {
  const h = normalHost(host);
  if (isIpLiteral(h)) return false;
  return !h.includes(".") || INTERNAL_SUFFIXES.some((s) => h.endsWith(s));
}

/**
 * Parse a host list setting (ALLOWED_HOSTS, FIRST_PARTY_HOSTS). Accepts commas and/or whitespace, strips quotes, schemes,
 * paths and ports, lowercases, and drops empty entries: `"https://A.com/x", b.com:443 *.c.dev` → a.com, b.com, *.c.dev.
 */
export function parseHostList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((e) =>
      e
        .replace(/["'`]/g, "")
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
        .replace(/[/?#].*$/, "")
        .replace(/:\d*$/, "")
        .replace(/\.+$/, "")
        .toLowerCase(),
    )
    .filter((e) => e && e !== "*." && e !== "*");
}

/** Exact host, or `*.suffix` for any subdomain of suffix (not the suffix itself). */
export function matchesHostList(host: string, entries: string[]): boolean {
  const h = normalHost(host);
  return entries.some((e) => (e.startsWith("*.") ? h.endsWith(e.slice(1)) && h.length > e.length - 1 : h === e));
}

// --------------------------------------------------------------------------------------------------------------- validation

/** Everything that can be decided without the network. */
export function checkTargetUrl(input: unknown, allowedHosts?: string): UrlCheck {
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

  const host = normalHost(url.hostname);
  if (host.startsWith("[") || host.includes(":")) return { ok: false, reason: "IPv6 literal addresses are not allowed; use a hostname." };
  const v4 = ipv4Octets(host);
  if (v4 && !isPublicIpv4(v4)) return { ok: false, reason: PRIVATE_REASON };
  if (isInternalName(host)) {
    return { ok: false, reason: "Single-label and internal host names (localhost, .local, .internal, .corp and similar) cannot be audited." };
  }
  const allow = parseHostList(allowedHosts);
  if (allow.length && !matchesHostList(host, allow)) return { ok: false, reason: "That host is not on this auditor's allow-list." };
  return { ok: true, url };
}

/** `checkTargetUrl`, then resolve a DNS name and refuse it unless every address it resolves to is public. Fails closed. */
export async function validateTargetUrl(input: unknown, allowedHosts: string | undefined, resolve: Resolver): Promise<UrlCheck> {
  const check = checkTargetUrl(input, allowedHosts);
  if (!check.ok) return check;
  const host = normalHost(check.url.hostname);
  if (ipv4Octets(host)) return check; // already checked as a literal

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: `Could not resolve ${host}, so it cannot be checked and is not audited.` };
  }
  if (addresses.length === 0) return { ok: false, reason: `${host} does not resolve to any address.` };
  if (!addresses.every(isPublicIp)) return { ok: false, reason: `${host} resolves to a private, loopback or reserved address. ${PRIVATE_REASON}` };
  return check;
}

// ------------------------------------------------------------------------------------------------------------------ DNS

const DOH_URL = "https://cloudflare-dns.com/dns-query";

/** A and AAAA lookups over DNS-over-HTTPS (JSON API). NXDOMAIN gives no addresses; any other failure throws. */
export function dohResolver(fetchFn: typeof fetch = fetch): Resolver {
  const lookup = async (host: string, type: "A" | "AAAA", code: number): Promise<string[]> => {
    const res = await fetchFn(`${DOH_URL}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" } });
    if (!res.ok) throw new Error(`DNS-over-HTTPS returned HTTP ${res.status}`);
    const body = (await res.json()) as { Status?: number; Answer?: { type?: number; data?: string }[] };
    if (body.Status === 3) return []; // NXDOMAIN
    if (body.Status !== 0) throw new Error(`DNS lookup failed with status ${body.Status}`);
    return (body.Answer ?? []).filter((a) => a.type === code && typeof a.data === "string").map((a) => a.data as string);
  };
  return async (host) => {
    const [a, aaaa] = await Promise.all([lookup(host, "A", 1), lookup(host, "AAAA", 28)]);
    return [...a, ...aaaa];
  };
}

/** Memoise a resolver for one audit run, so each host is looked up once (failures are cached too). */
export function cachedResolver(resolve: Resolver): Resolver {
  const cache = new Map<string, Promise<string[]>>();
  return (host) => {
    const key = normalHost(host);
    let p = cache.get(key);
    if (!p) {
      p = resolve(key);
      cache.set(key, p);
    }
    return p;
  };
}
