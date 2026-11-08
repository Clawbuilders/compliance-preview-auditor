# Bonus Track — compliance preview auditor

The take-home for **ClawBuilders S1:E6 — Build a Policy-as-Code Agent Committee on Cloudflare**.
The [workshop repo](https://github.com/Clawbuilders/cloudflare-compliance-reviewer) reviews the *diff*; this audits the
*running page*: what a first-time visitor actually gets before they have agreed to anything.

> Flags risk for humans. **Not legal advice.** Automated accessibility and consent checks are incomplete by nature.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Clawbuilders/compliance-preview-auditor)

## What one audit does

1. Opens the URL in **Cloudflare Browser Rendering** like a first-time visitor and **clicks nothing** — no consent is ever given.
2. Records every network request, then lists the **third-party hosts contacted before consent**, marking well-known trackers.
   Hosts that belong to the audited site are listed separately as **first-party requests** (see `FIRST_PARTY_HOSTS`).
3. Injects [axe-core](https://github.com/dequelabs/axe-core) and reports WCAG 2.0/2.1/2.2 A and AA violations with the
   success criterion each one maps to.
4. Takes one screenshot and asks **Clef** (Cloudflare's decision model, which can look at images) three yes/no questions:
   is a consent banner visible, is any text low-contrast, does the layout look broken. The answers are probabilities.
5. Combines them: *trackers loaded and no banner was visible* is called out for a human. A probability between 35% and
   65% is reported as *inconclusive — check by hand*, not as a finding.

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

Audit a public page you own: your own site or a pull request's preview URL, not someone else's site.

Local development uses a real remote browser: `npx wrangler dev --remote --var RUN_TOKEN:dev`.
Without `?format=markdown` you get JSON with both the structured result and the rendered report.

Point it at a pull request's preview URL from CI (below), call it from the committee in the
[workshop repo](https://github.com/Clawbuilders/cloudflare-compliance-reviewer), or have an agent call it: it is a plain
HTTP endpoint, so Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Hermes or any agent that can make a request can use it.

### Settings

| Name | Kind | What it does |
|---|---|---|
| `RUN_TOKEN` | secret | Bearer token for `POST /audit`. Unset means the endpoint does not exist (404). |
| `ALLOWED_HOSTS` | secret or var | Optional allow-list: exact hosts or `*.suffix`. |
| `FIRST_PARTY_HOSTS` | secret or var | Optional hosts that belong to your site on another domain, such as its API (`api.example-cdn.net`, `*.my-api.fly.dev`). |

Both host lists accept commas and/or spaces, and tolerate quotes, schemes, paths and ports: `"https://clawbuilders.club/",
*.my-app.pages.dev` is read as `clawbuilders.club` and `*.my-app.pages.dev`.

**`*.pages.dev` allows every Cloudflare Pages site on the internet**, not just yours. Use `*.<your-project>.pages.dev`
(the same goes for `*.workers.dev`, `*.vercel.app` and similar).

First party means: the audited page's registrable domain, or a host on `FIRST_PARTY_HOSTS`. The registrable domain is
approximated as the last two labels (`www.clawbuilders.club` → `clawbuilders.club`), or three under a short built-in list of
multi-part suffixes (`co.uk`, `com.au`, ...) and hosting platforms (`pages.dev`, `workers.dev`, `github.io`, `vercel.app`,
`fly.dev`, ...). It is not the full Public Suffix List. A well-known tracker is always listed as a third party.

### In CI: comment the report on every pull request

[`.github/workflows/preview-audit.yml`](.github/workflows/preview-audit.yml) is an **example** to copy into the repository
whose previews you want audited. On each successful `deployment_status` event (Cloudflare Pages and other preview hosts
create these) it posts the deployment URL to `$AUDITOR_URL/audit?format=markdown`, finds the open pull request for the
deployment's commit, and posts the report as a comment, updating the same comment on later pushes. It needs only
`contents: read` and `pull-requests: write`.

Set the repository variable `AUDITOR_URL` (your Worker's URL) and the secret `AUDITOR_TOKEN` (its `RUN_TOKEN`). Without
`AUDITOR_URL` the job is skipped, which is why it never runs in this repository.

## Safety
An auditor that fetches URLs people give it is a server-side request forgery risk. The submitted URL is refused when:

- the scheme is not `http` or `https`, it has credentials in it, or it is longer than 2048 characters;
- the host is an IPv6 literal, or an IPv4 literal that is private, loopback, link-local (including `169.254.169.254`),
  carrier-grade NAT (`100.64.0.0/10`), `0.0.0.0/8`, benchmarking, documentation, multicast or reserved. Integer, hex, octal
  and full-width-digit spellings (`2130706433`, `0x7f000001`) are normalised first, so they are caught too;
- the host is a single label (`localhost`, `metadata`, `instance-data`, `intranet`; a trailing dot changes nothing) or ends
  in `.localhost`, `.local`, `.localdomain`, `.internal`, `.intranet`, `.lan`, `.home`, `.home.arpa` or `.corp`;
- it is not on `ALLOWED_HOSTS`, when that is set;
- the name resolves (A and AAAA, over DNS-over-HTTPS at `cloudflare-dns.com`) to any non-public address: the IPv4 ranges
  above, or IPv6 loopback, unspecified, IPv4-mapped, NAT64, unique-local, link-local, multicast, documentation, Teredo,
  6to4 or anything outside global unicast. This catches names such as `localtest.me` and `127.0.0.1.nip.io`. If the
  lookup fails or returns nothing, the URL is refused.

Inside the browser every request is intercepted (`src/guard.ts`). Redirects and iframe navigations get the same checks,
including DNS (cached per host for the run; the allow-list applies to the main frame only). Subresources such as scripts,
images and API calls are aborted when their host is an IP literal or an internal name; they are not resolved, to keep page
loads fast. Aborted requests still appear in the report, marked as blocked. If the page itself redirects somewhere refused,
the audit stops with a 400.

These checks state intent and stop the easy cases; they are not the security boundary. The browser resolves names again
when it loads them, so a host that changes its DNS answer between the check and the load (DNS rebinding) is not caught here.
The outer boundary is Cloudflare's network: Browser Rendering runs there and cannot reach your private network.

```bash
npx wrangler secret put ALLOWED_HOSTS   # e.g. clawbuilders.club, *.my-app.pages.dev
```

## Limits (read this)
- It loads **one page**, not a site, and does not log in or click through flows.
- "Before consent" means before any interaction on first load. A site that sets consent from a prior cookie is outside this audit.
- Tracker detection is a list of well-known hosts, not proof of what data is sent.
- axe-core finds roughly the machine-detectable part of WCAG. A clean result is **not** a pass.
- Clef vision gives probabilities. Treat the banner/contrast/layout lines as a prompt to look, not a verdict.
- Browser Rendering on the Workers Free plan allows 3 concurrent browsers, 1 new browser every 20 seconds and 10
  browser-minutes per day; check Cloudflare's current limits before wiring this to every pull request.

## Troubleshooting

**`429` "Cloudflare Browser Rendering refused to start a browser because a plan limit was reached".** You hit a Browser
Rendering limit. On Workers Free that is 3 concurrent browsers, 1 new browser every 20 seconds, or 10 browser-minutes per
day. Wait and retry (the response carries `retry-after: 20`), space audits out, or move to Workers Paid.

**Every URL is refused with "not on this auditor's allow-list".** Check `ALLOWED_HOSTS` holds host names
(`clawbuilders.club`, `*.my-app.pages.dev`). Quotes, schemes and ports are tolerated; a typo in the host is not.

**"Could not resolve ... so it cannot be checked".** The DNS-over-HTTPS lookup failed or the name does not exist. The
auditor fails closed; retry, and check the name resolves publicly.

**`npm audit` warnings.** `npm audit` reports high-severity advisories in `basic-ftp`, `extract-zip`, `proxy-agent` and
`@puppeteer/browsers`. They come from `@cloudflare/puppeteer`'s Node-side browser installer, which is install-time
tooling: the Worker never runs it (Browser Rendering supplies the browser) and it is not reachable from a request. The only
offered fix downgrades `@cloudflare/puppeteer` to 0.0.11, so it is not applied.

## Layout
`src/url.ts` (validation and DNS checks) · `src/guard.ts` (in-browser request guard) · `src/network.ts` (first and third parties) · `src/axe.ts` and `src/axe-browser.ts` (axe results and runner) ·
`src/vision.ts` (Clef questions) · `src/audit.ts` (the browser session) · `src/report.ts` (markdown) · `src/errors.ts` · `test/`.

MIT. See [`NOTICE`](NOTICE).
