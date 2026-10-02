# Bonus Track — compliance preview auditor

The take-home for **ClawBuilders S1:E6 — Build a Policy-as-Code Agent Committee on Cloudflare**.
The [workshop repo](https://github.com/Clawbuilders/cloudflare-compliance-reviewer) reviews the *diff*; this audits the
*running page*: what a first-time visitor actually gets before they have agreed to anything.

> Flags risk for humans. **Not legal advice.** Automated accessibility and consent checks are incomplete by nature.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Clawbuilders/compliance-preview-auditor)

## What one audit does

1. Opens the URL in **Cloudflare Browser Rendering** like a first-time visitor and **clicks nothing** — no consent is ever given.
2. Records every network request, then lists the **third-party hosts contacted before consent**, marking well-known trackers.
3. Injects [axe-core](https://github.com/dequelabs/axe-core) and reports WCAG 2.0/2.1/2.2 A and AA violations with the
   success criterion each one maps to.
4. Takes one screenshot and asks **Clef** (Cloudflare's decision model, which can look at images) three yes/no questions:
   is a consent banner visible, is any text low-contrast, does the layout look broken. The answers are probabilities.
5. Combines them: *trackers loaded and no banner was visible* is called out for a human.

Real output for a live site (trimmed):

```
- serious — <html> element must have a lang attribute (html-has-lang, WCAG 3.1.1) — 1 element
- serious — All touch targets must be 24px large, or leave sufficient space (target-size, WCAG 2.5.8) — 3 elements
Third parties contacted before any consent interaction: us-assets.i.posthog.com — 7 requests — tracker: posthog
- No consent banner was visible (probability one is visible: 2%).
```

## Use it

```bash
npm install
npm test
npx wrangler secret put RUN_TOKEN                 # without a token the /audit endpoint does not exist (404)
npm run deploy
curl -X POST "https://<your-worker>.workers.dev/audit?format=markdown" \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"url":"https://pr-42.my-app.pages.dev/"}'
```

Local development uses a real remote browser: `npx wrangler dev --remote --var RUN_TOKEN:dev`.
Without `?format=markdown` you get JSON with both the structured result and the rendered report.

Point it at a pull request's preview URL from CI, or call it from the committee in the
[workshop repo](https://github.com/Clawbuilders/cloudflare-compliance-reviewer).

## Safety
An auditor that fetches URLs people give it is a server-side request forgery risk, so `src/url.ts` is strict and fully
tested: only `http(s)`; no credentials in the URL; no `localhost`, private, loopback, link-local or cloud-metadata
addresses (including integer and hex IPv4 forms); no IPv6 literals; and an optional allow-list.

```bash
npx wrangler secret put ALLOWED_HOSTS   # e.g. clawbuilders.club,*.pages.dev
```

## Limits (read this)
- It loads **one page**, not a site, and does not log in or click through flows.
- "Before consent" means before any interaction on first load. A site that sets consent from a prior cookie is outside this audit.
- Tracker detection is a list of well-known hosts, not proof of what data is sent.
- axe-core finds roughly the machine-detectable part of WCAG. A clean result is **not** a pass.
- Clef vision gives probabilities. Treat the banner/contrast/layout lines as a prompt to look, not a verdict.
- Browser Rendering on the Workers Free plan has a daily browser-time allowance and limited concurrency; check Cloudflare's
  current limits before wiring this to every pull request.

## Layout
`src/url.ts` (validation) · `src/network.ts` (third parties) · `src/axe.ts` and `src/axe-browser.ts` (axe results and runner) ·
`src/vision.ts` (Clef questions) · `src/audit.ts` (the browser session) · `src/report.ts` (markdown) · `test/` (23 tests).

MIT. See [`NOTICE`](NOTICE).
