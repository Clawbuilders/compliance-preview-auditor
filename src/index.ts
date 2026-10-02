import { auditUrl } from "./audit";
import { renderReport } from "./report";
import { validateTargetUrl } from "./url";
import type { AiBinding } from "./vision";

interface Env {
  BROWSER: Fetcher;
  AI: AiBinding;
  /** Bearer token for POST /audit. Unset = the endpoint does not exist (404), never open. */
  RUN_TOKEN?: string;
  /** Optional comma-separated allow-list of hosts, e.g. "clawbuilders.club,*.pages.dev". */
  ALLOWED_HOSTS?: string;
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return Response.json({ ok: true, auditEnabled: Boolean(env.RUN_TOKEN) });
    if (url.pathname !== "/audit") return new Response("ClawBuilders compliance preview auditor. POST /audit {\"url\": \"https://…\"} with a bearer token.");
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (!env.RUN_TOKEN) return new Response("Not found", { status: 404 });
    if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${env.RUN_TOKEN}`)) {
      return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
    }

    let body: { url?: unknown };
    try {
      body = (await request.json()) as { url?: unknown };
    } catch {
      return Response.json({ error: "Body must be JSON: {\"url\": \"https://…\"}" }, { status: 400 });
    }
    const target = validateTargetUrl(body.url, env.ALLOWED_HOSTS);
    if (!target.ok) return Response.json({ error: target.reason }, { status: 400 });

    try {
      const result = await auditUrl(env, target.url);
      const markdown = renderReport(result);
      if (url.searchParams.get("format") === "markdown") return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
      return Response.json({ result, markdown });
    } catch (e) {
      console.error("audit failed", e);
      return Response.json({ error: `The audit could not be completed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env>;
