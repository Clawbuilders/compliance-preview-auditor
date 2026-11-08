import type { AxeViolationSummary } from "./axe";
import type { ThirdParty } from "./network";

export interface VisionAnswers {
  consent_banner_visible: number;
  low_contrast_text: number;
  layout_broken: number;
}

export interface AuditResult {
  url: string;
  finalUrl: string;
  title: string;
  violations: AxeViolationSummary[];
  /** Other hosts of the audited site: same registrable domain, or listed in FIRST_PARTY_HOSTS. */
  firstParties: ThirdParty[];
  thirdParties: ThirdParty[];
  vision: VisionAnswers | null;
  visionTier: "clef" | "unavailable";
}

/** Everything from the audited page is untrusted: no pings, no HTML. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "@​");
const code = (s: string) => "`" + s.replace(/`/g, "").replace(/</g, "‹").replace(/>/g, "›").replace(/@/g, "@​") + "`";
const pct = (p: number) => `${Math.round(p * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Probabilities near 50% are not findings: the model is unsure, so a person should look. */
export const INCONCLUSIVE_LOW = 0.35;
export const INCONCLUSIVE_HIGH = 0.65;
const INCONCLUSIVE = "inconclusive — check by hand";

export function verdict(p: number): "unlikely" | "inconclusive" | "likely" {
  if (p < INCONCLUSIVE_LOW) return "unlikely";
  if (p > INCONCLUSIVE_HIGH) return "likely";
  return "inconclusive";
}

const judged = (p: number) => (verdict(p) === "inconclusive" ? `${INCONCLUSIVE} (${pct(p)})` : pct(p));

function hostLine(t: ThirdParty): string {
  const tracker = t.tracker ? ` — **tracker: ${esc(t.tracker)}**` : "";
  const blocked = t.blocked ? ` — ${t.blocked === t.requests ? "all" : t.blocked} blocked by the auditor (internal or IP-literal address)` : "";
  return `- ${code(t.host)} — ${plural(t.requests, "request", "requests")}${tracker}${blocked}`;
}

export function renderReport(r: AuditResult): string {
  const host = (() => {
    try {
      return new URL(r.finalUrl || r.url).host;
    } catch {
      return r.url;
    }
  })();
  const lines: string[] = [`## Preview audit — ${esc(host)}`, ""];
  if (r.title) lines.push(`Page title: ${esc(r.title)}`, "");

  lines.push("### Accessibility (axe-core, WCAG 2.2 A/AA)");
  if (r.violations.length === 0) {
    lines.push("No accessibility violations found by axe-core on this page. Automated checks cover only part of WCAG, so this is not a pass.");
  } else {
    for (const v of r.violations) {
      const criteria = v.wcag.length ? `, ${v.wcag.map((c) => `WCAG ${c}`).join(", ")}` : "";
      lines.push(`- **${esc(v.impact)}** — ${esc(v.help)} (${code(v.id)}${criteria}) — ${plural(v.nodes, "element", "elements")}: ${v.samples.map(code).join(", ")} — [rule](${v.helpUrl})`);
    }
  }

  lines.push("", "### Third parties contacted before any consent interaction");
  if (r.thirdParties.length === 0) {
    lines.push("No third-party requests were made before any consent interaction.");
  } else {
    lines.push("The page was loaded and **nothing was clicked** — no consent was given — yet it contacted:");
    for (const t of r.thirdParties) lines.push(hostLine(t));
  }

  if (r.firstParties.length) {
    lines.push("", "### First-party requests");
    lines.push("Other hosts of the audited site (same registrable domain, or listed in `FIRST_PARTY_HOSTS`). Listed for completeness; these are not third parties.");
    for (const t of r.firstParties) lines.push(hostLine(t));
  }

  lines.push("", "### Screenshot checks");
  if (!r.vision) {
    lines.push("The screenshot check was unavailable for this run (the vision model did not answer), so nothing is claimed about banners, contrast or layout.");
  } else {
    lines.push("Clef vision returns probabilities, not certainties. Anything between 35% and 65% is reported as inconclusive.", "");
    const banner = r.vision.consent_banner_visible;
    const bannerLine = {
      unlikely: `- No consent banner was visible (probability one is visible: ${pct(banner)}).`,
      likely: `- A consent banner appears to be visible (${pct(banner)}).`,
      inconclusive: `- Consent banner: ${INCONCLUSIVE} (${pct(banner)}).`,
    }[verdict(banner)];
    lines.push(bannerLine, `- Low-contrast text: ${judged(r.vision.low_contrast_text)}`, `- Broken layout: ${judged(r.vision.layout_broken)}`);
    if (r.thirdParties.some((t) => t.tracker)) {
      if (verdict(banner) === "unlikely") lines.push("", "Trackers loaded and no consent banner was visible — a consent question worth a human look.");
      if (verdict(banner) === "inconclusive") lines.push("", "Trackers loaded and it is unclear whether a consent banner was visible — check the page by hand.");
    }
  }

  lines.push("", "---", "<sub>This flags risk for humans and is **not legal advice**. Automated accessibility and consent checks are incomplete by nature; verify with an audit and qualified counsel.</sub>");
  return lines.join("\n");
}
