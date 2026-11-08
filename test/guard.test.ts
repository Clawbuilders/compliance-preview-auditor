import { describe, expect, it } from "vitest";
import { createRequestGuard } from "../src/guard";
import { cachedResolver, type Resolver } from "../src/url";

const dns: Record<string, string[]> = {
  "preview.my-app.pages.dev": ["172.66.44.1"],
  "cdn.example.com": ["93.184.215.14"],
  "www.youtube.com": ["142.250.1.1"],
  "localtest.me": ["127.0.0.1"],
  "169.254.169.254.nip.io": ["169.254.169.254"],
};
function counting() {
  const lookups: string[] = [];
  const resolve: Resolver = async (h) => {
    lookups.push(h);
    if (h in dns) return dns[h];
    throw new Error("SERVFAIL");
  };
  return { resolve: cachedResolver(resolve), lookups };
}

describe("request guard — redirects, iframes and subresources", () => {
  it("re-checks redirect targets of the main frame, including DNS", async () => {
    const { resolve } = counting();
    const guard = createRequestGuard({ resolve });
    expect(await guard("https://preview.my-app.pages.dev/", "main-frame-navigation")).toEqual({ allow: true });
    for (const u of ["http://localtest.me/", "http://169.254.169.254.nip.io/latest/meta-data/", "http://127.0.0.1/", "http://[::1]/", "http://metadata/", "http://db.internal/", "file:///etc/passwd", "https://unresolvable.example/"]) {
      expect(await guard(u, "main-frame-navigation"), u).toMatchObject({ allow: false });
    }
  });

  it("applies the allow-list to the main frame only, but the SSRF checks to iframes too", async () => {
    const { resolve } = counting();
    const guard = createRequestGuard({ allowedHosts: "*.my-app.pages.dev", resolve });
    expect(await guard("https://www.youtube.com/embed/x", "main-frame-navigation")).toMatchObject({ allow: false });
    expect(await guard("https://www.youtube.com/embed/x", "frame-navigation")).toEqual({ allow: true });
    expect(await guard("http://localtest.me/", "frame-navigation")).toMatchObject({ allow: false });
  });

  it("blocks subresources on IP literals and internal names without a DNS lookup", async () => {
    const { resolve, lookups } = counting();
    const guard = createRequestGuard({ resolve });
    for (const u of ["http://10.0.0.1/x.js", "http://8.8.8.8/pixel.gif", "http://[fd00::1]/a", "http://2130706433/", "http://metadata/v1", "http://printer.local/img", "http://intranet/api"]) {
      expect(await guard(u, "subresource"), u).toMatchObject({ allow: false });
    }
    expect(await guard("https://cdn.example.com/app.js", "subresource")).toEqual({ allow: true });
    expect(await guard("https://localtest.me/app.js", "subresource")).toEqual({ allow: true }); // DNS is only checked for navigations
    expect(lookups).toEqual([]);
  });

  it("lets data:, blob: and about: through and blocks other schemes", async () => {
    const guard = createRequestGuard({ resolve: counting().resolve });
    for (const u of ["data:image/png;base64,AAAA", "blob:https://x.example/1", "about:blank"]) expect(await guard(u, "subresource"), u).toEqual({ allow: true });
    expect(await guard("ftp://x.example/", "subresource")).toMatchObject({ allow: false });
    expect(await guard("::nope::", "subresource")).toMatchObject({ allow: false });
  });

  it("looks each navigation host up once per run", async () => {
    const { resolve, lookups } = counting();
    const guard = createRequestGuard({ resolve });
    await guard("https://preview.my-app.pages.dev/", "main-frame-navigation");
    await guard("https://preview.my-app.pages.dev/next", "main-frame-navigation");
    await guard("https://preview.my-app.pages.dev/", "frame-navigation");
    expect(lookups).toEqual(["preview.my-app.pages.dev"]);
  });
});
