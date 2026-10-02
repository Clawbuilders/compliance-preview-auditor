import { describe, expect, it } from "vitest";
import { validateTargetUrl } from "../src/url";

const ok = (input: unknown, allowed?: string) => validateTargetUrl(input, allowed);

describe("validateTargetUrl — an auditor that fetches URLs must not become an SSRF tool", () => {
  it("accepts ordinary http(s) URLs and normalises them", () => {
    const r = ok("  https://clawbuilders.club/events?x=1#top ");
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.url.href).toBe("https://clawbuilders.club/events?x=1#top");
    expect(ok("http://example.com")).toMatchObject({ ok: true });
  });

  it("rejects non-http schemes", () => {
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com", "data:text/html,<h1>x</h1>", "chrome://settings", "gopher://x"]) {
      expect(ok(u), u).toMatchObject({ ok: false });
    }
  });

  it("rejects localhost and private, loopback and link-local addresses", () => {
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
    ]) {
      expect(ok(u), u).toMatchObject({ ok: false });
    }
  });

  it("allows public addresses that merely look similar", () => {
    for (const u of ["http://172.32.0.1/", "http://11.0.0.1/", "http://8.8.8.8/"]) expect(ok(u), u).toMatchObject({ ok: true });
  });

  it("rejects embedded credentials, garbage, empty and oversized input", () => {
    expect(ok("https://user:pw@example.com/")).toMatchObject({ ok: false });
    expect(ok("https://user@example.com/")).toMatchObject({ ok: false });
    expect(ok("not a url")).toMatchObject({ ok: false });
    expect(ok("")).toMatchObject({ ok: false });
    expect(ok(undefined)).toMatchObject({ ok: false });
    expect(ok(42)).toMatchObject({ ok: false });
    expect(ok("https://example.com/" + "a".repeat(3000))).toMatchObject({ ok: false });
  });

  it("enforces an allow-list when one is configured (exact host or *.suffix)", () => {
    const allow = "clawbuilders.club, *.pages.dev";
    expect(ok("https://clawbuilders.club/x", allow)).toMatchObject({ ok: true });
    expect(ok("https://pr-7.my-app.pages.dev/", allow)).toMatchObject({ ok: true });
    expect(ok("https://evil.example/", allow)).toMatchObject({ ok: false });
    expect(ok("https://clawbuilders.club.evil.example/", allow)).toMatchObject({ ok: false });
    expect(ok("https://notpages.dev/", allow)).toMatchObject({ ok: false });
  });

  it("gives a reason a person can act on", () => {
    const r = ok("http://localhost:3000");
    expect(!r.ok && r.reason).toMatch(/private|local/i);
  });
});
