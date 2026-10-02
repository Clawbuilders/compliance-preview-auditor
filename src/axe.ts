/** Pure helpers over axe-core's JSON results (the browser-side runner lives in axe-browser.ts). */

export interface AxeViolationSummary {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  /** WCAG success criteria, e.g. "1.4.3". Empty for best-practice rules. */
  wcag: string[];
  nodes: number;
  /** First few selectors, to find the elements. */
  samples: string[];
}

const IMPACT_RANK: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const MAX_SAMPLES = 3;

/** "wcag143" → "1.4.3", "wcag1410" → "1.4.10". Level tags such as "wcag2aa" are not criteria and are ignored. */
export function wcagCriteria(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const m = t.match(/^wcag(\d)(\d)(\d{1,2})$/);
    if (m) out.add(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...out].sort((a, b) => {
    const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

function selector(target: unknown): string {
  const t = Array.isArray(target) ? target[0] : target;
  return Array.isArray(t) ? t.join(" ") : String(t ?? "");
}

export function summarizeAxe(results: unknown): AxeViolationSummary[] {
  const violations = (results as { violations?: unknown[] } | undefined)?.violations;
  if (!Array.isArray(violations)) return [];
  return violations
    .map((v: any): AxeViolationSummary => ({
      id: String(v?.id ?? "unknown"),
      impact: String(v?.impact ?? "unknown"),
      help: String(v?.help ?? ""),
      helpUrl: String(v?.helpUrl ?? ""),
      wcag: wcagCriteria(Array.isArray(v?.tags) ? v.tags : []),
      nodes: Array.isArray(v?.nodes) ? v.nodes.length : 0,
      samples: (Array.isArray(v?.nodes) ? v.nodes : []).slice(0, MAX_SAMPLES).map((n: any) => selector(n?.target)),
    }))
    .sort((a, b) => (IMPACT_RANK[a.impact] ?? 4) - (IMPACT_RANK[b.impact] ?? 4));
}
