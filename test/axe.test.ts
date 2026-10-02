import { describe, expect, it } from "vitest";
import { summarizeAxe, wcagCriteria } from "../src/axe";

describe("wcagCriteria", () => {
  it("turns axe tags into dotted success-criterion numbers and ignores level tags", () => {
    expect(wcagCriteria(["cat.text-alternatives", "wcag2a", "wcag111", "wcag143", "wcag1410", "wcag258", "best-practice"])).toEqual(["1.1.1", "1.4.3", "1.4.10", "2.5.8"]);
    expect(wcagCriteria([])).toEqual([]);
  });
});

describe("summarizeAxe", () => {
  const raw = {
    violations: [
      { id: "color-contrast", impact: "serious", help: "Elements must meet minimum color contrast", helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast", tags: ["wcag2aa", "wcag143"], nodes: [{ target: [".a"] }, { target: [".b"] }, { target: [".c"] }, { target: [".d"] }] },
      { id: "image-alt", impact: "critical", help: "Images must have alternative text", helpUrl: "https://x/image-alt", tags: ["wcag2a", "wcag111"], nodes: [{ target: ["img.hero"] }] },
      { id: "region", impact: "moderate", help: "All page content should be contained by landmarks", helpUrl: "https://x/region", tags: ["best-practice"], nodes: [{ target: ["p"] }] },
    ],
  };

  it("orders by impact (critical first), counts nodes and caps sample selectors", () => {
    const s = summarizeAxe(raw);
    expect(s.map((v) => v.id)).toEqual(["image-alt", "color-contrast", "region"]);
    const contrast = s.find((v) => v.id === "color-contrast")!;
    expect(contrast.nodes).toBe(4);
    expect(contrast.samples).toEqual([".a", ".b", ".c"]);
    expect(contrast.wcag).toEqual(["1.4.3"]);
    expect(s.find((v) => v.id === "region")!.wcag).toEqual([]);
  });

  it("tolerates missing or malformed results", () => {
    expect(summarizeAxe(undefined)).toEqual([]);
    expect(summarizeAxe({})).toEqual([]);
    expect(summarizeAxe({ violations: [{ id: "x" }] })).toHaveLength(1);
  });
});
