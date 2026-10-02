import { describe, expect, it } from "vitest";
import { registrableDomain, thirdPartyRequests } from "../src/network";

describe("registrableDomain", () => {
  it("returns the site-level domain, including multi-part public suffixes", () => {
    expect(registrableDomain("www.example.com")).toBe("example.com");
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("shop.example.com.au")).toBe("example.com.au");
    expect(registrableDomain("example.com")).toBe("example.com");
    expect(registrableDomain("localhost")).toBe("localhost");
  });
});

describe("thirdPartyRequests", () => {
  const page = "https://www.example.co.uk/";
  const req = (url: string) => ({ url });

  it("excludes same-site hosts (other subdomains of the same registrable domain)", () => {
    expect(thirdPartyRequests([req("https://cdn.example.co.uk/a.js"), req("https://www.example.co.uk/b.css")], page)).toEqual([]);
  });

  it("lists third-party hosts once each, sorted, with request counts", () => {
    const out = thirdPartyRequests(
      [req("https://zeta.example.net/1"), req("https://alpha.example.org/1"), req("https://alpha.example.org/2"), req("https://zeta.example.net/2")],
      page,
    );
    expect(out.map((o) => [o.host, o.requests])).toEqual([["alpha.example.org", 2], ["zeta.example.net", 2]]);
  });

  it("recognises well-known trackers and marks them", () => {
    const out = thirdPartyRequests(
      [req("https://www.google-analytics.com/g/collect"), req("https://connect.facebook.net/en_US/fbevents.js"), req("https://us.i.posthog.com/e/"), req("https://static.hotjar.com/c/x.js"), req("https://fonts.gstatic.com/s/x.woff2")],
      page,
    );
    const by = Object.fromEntries(out.map((o) => [o.host, o.tracker]));
    expect(by["www.google-analytics.com"]).toBe("google-analytics");
    expect(by["connect.facebook.net"]).toBe("facebook");
    expect(by["us.i.posthog.com"]).toBe("posthog");
    expect(by["static.hotjar.com"]).toBe("hotjar");
    expect(by["fonts.gstatic.com"]).toBeUndefined();
  });

  it("ignores data:, blob:, about: and malformed URLs", () => {
    expect(thirdPartyRequests([req("data:image/png;base64,AAAA"), req("blob:https://www.example.co.uk/1"), req("about:blank"), req("::not a url::")], page)).toEqual([]);
  });

  it("lists trackers first so the important rows lead", () => {
    const out = thirdPartyRequests([req("https://a-cdn.example.org/x"), req("https://www.googletagmanager.com/gtm.js")], page);
    expect(out[0].host).toBe("www.googletagmanager.com");
  });
});
