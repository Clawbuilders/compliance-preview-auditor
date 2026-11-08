import { describe, expect, it } from "vitest";
import { renderReport, type AuditResult } from "../src/report";

const base: AuditResult = {
  url: "https://pr-7.my-app.pages.dev/",
  finalUrl: "https://pr-7.my-app.pages.dev/",
  title: "My App",
  violations: [
    { id: "image-alt", impact: "critical", help: "Images must have alternative text", helpUrl: "https://x/image-alt", wcag: ["1.1.1"], nodes: 2, samples: ["img.hero", "img.logo"] },
  ],
  firstParties: [],
  thirdParties: [
    { host: "www.google-analytics.com", requests: 3, tracker: "google-analytics" },
    { host: "fonts.gstatic.com", requests: 1 },
  ],
  vision: { consent_banner_visible: 0.04, low_contrast_text: 0.71, layout_broken: 0.02 },
  visionTier: "clef",
};

describe("renderReport", () => {
  it("summarises counts and cites WCAG criteria and the rule help", () => {
    const md = renderReport(base);
    expect(md).toContain("pr-7.my-app.pages.dev");
    expect(md).toContain("image-alt");
    expect(md).toContain("WCAG 1.1.1");
    expect(md).toContain("2 elements");
    expect(md).toContain("https://x/image-alt");
  });

  it("flags trackers that loaded BEFORE any consent interaction, and says when no banner was seen", () => {
    const md = renderReport(base);
    expect(md).toMatch(/before (any )?consent/i);
    expect(md).toContain("www.google-analytics.com");
    expect(md).toMatch(/google-analytics/);
    expect(md).toMatch(/no consent banner/i); // consent_banner_visible = 0.04
  });

  it("reports vision probabilities as probabilities, not certainties", () => {
    const md = renderReport(base);
    expect(md).toContain("71%"); // low_contrast_text
    expect(md).toMatch(/probabilit/i);
  });

  it("says so when the vision check was unavailable", () => {
    const md = renderReport({ ...base, vision: null, visionTier: "unavailable" });
    expect(md).toMatch(/screenshot check was unavailable/i);
  });

  it("handles a clean page", () => {
    const md = renderReport({ ...base, violations: [], thirdParties: [], vision: { consent_banner_visible: 0.9, low_contrast_text: 0.01, layout_broken: 0.01 } });
    expect(md).toMatch(/no accessibility violations/i);
    expect(md).toMatch(/no third-party requests/i);
  });

  it("neutralises markup coming from the audited page (titles, selectors, hosts)", () => {
    const md = renderReport({
      ...base,
      title: "<script>alert(1)</script> @everyone",
      violations: [{ ...base.violations[0], samples: ["img[onerror=\"x\"]<b>", "@octocat"] }],
    });
    expect(md).not.toContain("<script>");
    expect(md).not.toContain("<b>");
    expect(md).not.toMatch(/@(everyone|octocat)/);
  });

  it("always carries the disclaimer", () => {
    expect(renderReport(base)).toMatch(/not legal advice/i);
  });

  it("lists first-party hosts separately from third parties, and only when there are any", () => {
    expect(renderReport(base)).not.toMatch(/first-party requests/i);
    const md = renderReport({ ...base, firstParties: [{ host: "api.my-app.pages.dev", requests: 4 }] });
    const [third, first] = [md.indexOf("### Third parties"), md.indexOf("### First-party requests")];
    expect(first).toBeGreaterThan(third);
    expect(md.slice(first)).toContain("api.my-app.pages.dev");
    expect(md.slice(third, first)).not.toContain("api.my-app.pages.dev");
  });

  it("marks requests the auditor blocked", () => {
    const md = renderReport({ ...base, thirdParties: [{ host: "10.0.0.1", requests: 2, blocked: 2 }] });
    expect(md).toMatch(/10\.0\.0\.1.*all blocked by the auditor/);
  });
});
