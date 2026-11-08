import { describe, expect, it } from "vitest";
import { cachedResolver, checkTargetUrl, dohResolver, isPublicIp, parseHostList, validateTargetUrl, type Resolver } from "../src/url";

/** Every DNS name resolves to one public address unless a test says otherwise. No test touches the network. */
const publicDns: Resolver = async () => ["93.184.215.14"];
const ok = (input: unknown, allowed?: string, resolve: Resolver = publicDns) => validateTargetUrl(input, allowed, resolve);

describe("validateTargetUrl — an auditor that fetches URLs must not become an SSRF tool", () => {
  it("accepts ordinary http(s) URLs and normalises them", async () => {
    const r = await ok("  https://clawbuilders.club/events?x=1#top ");
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.url.href).toBe("https://clawbuilders.club/events?x=1#top");
    expect(await ok("http://example.com")).toMatchObject({ ok: true });
  });

  it("rejects non-http schemes", async () => {
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com", "data:text/html,<h1>x</h1>", "chrome://settings", "gopher://x"]) {
      expect(await ok(u), u).toMatchObject({ ok: false });
    }
  });

  it("rejects localhost and private, loopback and link-local addresses", async () => {
    for (const u of [
      "http://localhost:8787",
      "http://foo.localhost/",
      "http://127.0.0.1/",
      "http://127.1.2.3/",
      "http://0.0.0.0/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://2130706433/", // 127.0.0.1 as a single integer
      "http://0x7f000001/", // 127.0.0.1 in hex
      "http://metadata.google.internal/",
      "http://printer.local/",
      "http://0177.0.0.1/", // octal
      "http://\uff11\uff12\uff17.\uff10.\uff10.\uff11/", // full-width digits
      "http://localhost./",
      "http://localhost../",
      "http://[::]/",
      "http://[64:ff9b::7f00:1]/",
      "http://224.0.0.1/",
      "http://255.255.255.255/",
    ]) {
      expect(await ok(u), u).toMatchObject({ ok: false });
    }
  });

  it("allows public addresses that merely look similar", async () => {
    for (const u of ["http://172.32.0.1/", "http://11.0.0.1/", "http://8.8.8.8/"]) expect(await ok(u), u).toMatchObject({ ok: true });
  });

  it("rejects embedded credentials, garbage, empty and oversized input", async () => {
    expect(await ok("https://user:pw@example.com/")).toMatchObject({ ok: false });
    expect(await ok("https://user@example.com/")).toMatchObject({ ok: false });
    expect(await ok("not a url")).toMatchObject({ ok: false });
    expect(await ok("")).toMatchObject({ ok: false });
    expect(await ok(undefined)).toMatchObject({ ok: false });
    expect(await ok(42)).toMatchObject({ ok: false });
    expect(await ok("https://example.com/" + "a".repeat(3000))).toMatchObject({ ok: false });
  });

  it("enforces an allow-list when one is configured (exact host or *.suffix)", async () => {
    const allow = "clawbuilders.club, *.pages.dev";
    expect(await ok("https://clawbuilders.club/x", allow)).toMatchObject({ ok: true });
    expect(await ok("https://pr-7.my-app.pages.dev/", allow)).toMatchObject({ ok: true });
    expect(await ok("https://evil.example/", allow)).toMatchObject({ ok: false });
    expect(await ok("https://clawbuilders.club.evil.example/", allow)).toMatchObject({ ok: false });
    expect(await ok("https://notpages.dev/", allow)).toMatchObject({ ok: false });
  });

  it("gives a reason a person can act on", async () => {
    const r = await ok("http://localhost:3000");
    expect(!r.ok && r.reason).toMatch(/private|local/i);
  });

  it("rejects single-label hosts and internal suffixes", async () => {
    for (const u of [
      "http://metadata/computeMetadata/v1/",
      "http://instance-data/latest/",
      "http://intranet/",
      "http://wiki.corp/",
      "http://db.internal/",
      "http://nas.lan/",
      "http://router.home.arpa/",
      "http://app.localhost/",
      "http://box.local./",
    ]) {
      expect(await ok(u), u).toMatchObject({ ok: false });
    }
  });
});

describe("validateTargetUrl — DNS names are resolved and refused if any answer is not public", () => {
  // What these names really resolve to, so the tests do not depend on the network.
  const fakeDns: Record<string, string[]> = {
    "localtest.me": ["127.0.0.1"],
    "127.0.0.1.nip.io": ["127.0.0.1"],
    "169.254.169.254.nip.io": ["169.254.169.254"],
    "192.168.1.1.sslip.io": ["192.168.1.1"],
    "cgnat.example.com": ["100.64.1.1"],
    "mixed.example.com": ["93.184.215.14", "10.0.0.1"],
    "v6-loopback.example.com": ["::1"],
    "v6-ula.example.com": ["fd12:3456::1"],
    "v6-linklocal.example.com": ["fe80::1"],
    "v6-mapped.example.com": ["::ffff:127.0.0.1"],
    "v6-multicast.example.com": ["ff02::1"],
    "v6-public.example.com": ["2606:4700::6810:84e5"],
    "empty.example.com": [],
  };
  const resolve: Resolver = async (h) => {
    if (h in fakeDns) return fakeDns[h];
    throw new Error("SERVFAIL");
  };

  it("refuses names that resolve to loopback, private, link-local, CGNAT or non-public IPv6", async () => {
    for (const h of ["localtest.me", "127.0.0.1.nip.io", "169.254.169.254.nip.io", "192.168.1.1.sslip.io", "cgnat.example.com", "mixed.example.com", "v6-loopback.example.com", "v6-ula.example.com", "v6-linklocal.example.com", "v6-mapped.example.com", "v6-multicast.example.com"]) {
      const r = await ok(`https://${h}/`, undefined, resolve);
      expect(r, h).toMatchObject({ ok: false });
      expect(!r.ok && r.reason, h).toMatch(/private|loopback|reserved/i);
    }
  });

  it("fails closed when resolution fails or returns nothing", async () => {
    expect(await ok("https://unknown.example.com/", undefined, resolve)).toMatchObject({ ok: false });
    expect(await ok("https://empty.example.com/", undefined, resolve)).toMatchObject({ ok: false });
  });

  it("accepts names that resolve only to public addresses, and skips DNS for IPv4 literals", async () => {
    expect(await ok("https://v6-public.example.com/", undefined, resolve)).toMatchObject({ ok: true });
    expect(await ok("http://8.8.8.8/", undefined, resolve)).toMatchObject({ ok: true });
  });

  it("checks the allow-list before spending a DNS lookup", async () => {
    let lookups = 0;
    const counting: Resolver = async () => (lookups++, ["93.184.215.14"]);
    expect(await ok("https://evil.example/", "clawbuilders.club", counting)).toMatchObject({ ok: false });
    expect(lookups).toBe(0);
  });
});

describe("isPublicIp", () => {
  it("classifies IPv4 and IPv6 addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:82a::200e"]) expect(isPublicIp(ip), ip).toBe(true);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "192.0.2.1", "240.0.0.1", "::1", "::", "fc00::1", "fd00:ec2::254", "fe80::1", "fec0::1", "ff02::1", "::ffff:8.8.8.8", "::ffff:7f00:1", "64:ff9b::808:808", "2001:db8::1", "2002:7f00:1::1", "2001:0:1::1", "not an ip", "1:2:3"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });
});

describe("parseHostList", () => {
  it("splits on commas and whitespace, strips quotes, schemes, paths and ports, lowercases, drops empties", () => {
    expect(parseHostList('"clawbuilders.club,*.my-app.pages.dev"')).toEqual(["clawbuilders.club", "*.my-app.pages.dev"]);
    expect(parseHostList("clawbuilders.club *.my-app.pages.dev")).toEqual(["clawbuilders.club", "*.my-app.pages.dev"]);
    expect(parseHostList("https://X.com/path, http://y.com:8443/ ,,  'z.dev.' ")).toEqual(["x.com", "y.com", "z.dev"]);
    expect(parseHostList("")).toEqual([]);
    expect(parseHostList(undefined)).toEqual([]);
    expect(parseHostList(' , "" * ')).toEqual([]);
  });

  it("makes messy ALLOWED_HOSTS values work instead of refusing everything", async () => {
    for (const allow of ['"clawbuilders.club"', "https://clawbuilders.club", "other.dev clawbuilders.club", "CLAWBUILDERS.CLUB/"]) {
      expect(await ok("https://clawbuilders.club/", allow), allow).toMatchObject({ ok: true });
    }
    expect(await ok("https://evil.example/", "https://clawbuilders.club")).toMatchObject({ ok: false });
  });
});

describe("checkTargetUrl", () => {
  it("is the network-free part of validation", () => {
    expect(checkTargetUrl("https://localtest.me/")).toMatchObject({ ok: true }); // only DNS can tell
    expect(checkTargetUrl("http://metadata/")).toMatchObject({ ok: false });
  });
});

describe("dohResolver and cachedResolver", () => {
  const dohFetch = (answers: Record<string, unknown>) => {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      calls.push(`${u.searchParams.get("name")}/${u.searchParams.get("type")}`);
      expect(new Headers(init?.headers).get("accept")).toBe("application/dns-json");
      const body = answers[`${u.searchParams.get("name")}/${u.searchParams.get("type")}`];
      if (body === undefined) return new Response("no", { status: 500 });
      return Response.json(body);
    }) as typeof fetch;
    return { f, calls };
  };

  it("collects A and AAAA answers and ignores CNAME records", async () => {
    const { f } = dohFetch({
      "a.example/A": { Status: 0, Answer: [{ type: 5, data: "b.example." }, { type: 1, data: "127.0.0.1" }] },
      "a.example/AAAA": { Status: 0, Answer: [{ type: 28, data: "::1" }] },
    });
    expect(await dohResolver(f)("a.example")).toEqual(["127.0.0.1", "::1"]);
  });

  it("treats NXDOMAIN as no addresses and anything else as a failure", async () => {
    const { f } = dohFetch({ "nx.example/A": { Status: 3 }, "nx.example/AAAA": { Status: 3 }, "sf.example/A": { Status: 2 }, "sf.example/AAAA": { Status: 0 } });
    expect(await dohResolver(f)("nx.example")).toEqual([]);
    await expect(dohResolver(f)("sf.example")).rejects.toThrow();
    await expect(dohResolver(f)("down.example")).rejects.toThrow();
  });

  it("looks each host up once per run", async () => {
    const { f, calls } = dohFetch({ "a.example/A": { Status: 0, Answer: [{ type: 1, data: "8.8.8.8" }] }, "a.example/AAAA": { Status: 0 } });
    const r = cachedResolver(dohResolver(f));
    await r("a.example");
    await r("A.example.");
    expect(calls).toEqual(["a.example/A", "a.example/AAAA"]);
  });
});
