/**
 * TrustData AI Bot Collector — Cloudflare Worker.
 *
 * Runs as middleware on every request the customer's zone serves. Two jobs:
 *
 *  1. Forwards a compact log entry to TrustData's ingest endpoint for AI-bot
 *     observability. Fires-and-forgets — does NOT alter the customer response.
 *
 *  2. Intercepts `/.well-known/webmcp.json`: fetches the signed WebMCP
 *     manifest from the TrustData API, caches it in KV for 1 hour, and
 *     serves it as JSON so AI agents can discover the site's tool surface
 *     before loading any page.
 *
 * Classification (bot vs referral vs ignore) happens server-side so new AI
 * bots get captured retroactively — no re-deploy needed when a new UA appears.
 *
 * Payload shape is a JSON array (batched by the fetch, one element today) so
 * we can grow into larger batches without changing the wire format.
 */

export interface Env {
  TRUSTDATA_INGEST_URL: string;
  TRUSTDATA_API_KEY: string;
  TRUSTDATA_ATTRIBUTION_ID: string;
  // WebMCP hosting (Phase 3). Optional — leave unset to disable the
  // /.well-known/webmcp.json interceptor. Pre-filled in wrangler.jsonc to
  // the canonical TrustData endpoint; customers normally don't change it.
  TRUSTDATA_MANIFEST_URL?: string;
  // KV namespace used to cache the signed manifest. Optional — if the binding
  // isn't declared, the Worker will fetch upstream on every request (still
  // correct, just less efficient).
  WEBMCP_CACHE?: KVNamespace;
}

export interface LogEntry {
  timestamp: number;
  attribution_id: string;
  host: string;
  method: string;
  pathname: string;
  query_params: Record<string, string>;
  ip: string | null;
  user_agent: string | null;
  referer: string | null;
  bytes: number;
  status: number;
  country?: string;
  asn?: number;
}

// Kept in sync with the Django endpoint's Cache-Control max-age; the Worker
// uses its own TTL so we can evict faster on manual rotation without
// waiting for the upstream cache to expire.
export const WEBMCP_CACHE_TTL_SECONDS = 3600;
export const WEBMCP_CACHE_KEY_PREFIX = "webmcp:v1:";
export const WEBMCP_PATH = "/.well-known/webmcp.json";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === WEBMCP_PATH) {
      return serveWebmcpManifest(request, env, ctx);
    }

    const response = await fetch(request);
    // Clone so the outbound ingest call can read headers/body independently.
    const responseClone = response.clone();
    ctx.waitUntil(forwardLog(request, responseClone, env));
    return response;
  },
} satisfies ExportedHandler<Env>;

export async function forwardLog(
  request: Request,
  response: Response,
  env: Env,
): Promise<void> {
  if (!env.TRUSTDATA_INGEST_URL || !env.TRUSTDATA_API_KEY) {
    return;
  }

  const url = new URL(request.url);
  const responseBody = await response.blob();
  const headerSize = Array.from(response.headers.entries()).reduce(
    (total, [key, value]) => total + key.length + value.length + 4, // ": " + "\r\n"
    0,
  );

  const log: LogEntry = {
    timestamp: Date.now(),
    attribution_id: env.TRUSTDATA_ATTRIBUTION_ID ?? "",
    host: url.hostname,
    method: request.method,
    pathname: url.pathname,
    query_params: Object.fromEntries(url.searchParams),
    ip: request.headers.get("cf-connecting-ip"),
    user_agent: request.headers.get("user-agent"),
    referer: request.headers.get("referer"),
    bytes: headerSize + responseBody.size,
    status: response.status,
    country: (request as unknown as { cf?: { country?: string } }).cf?.country,
    asn: (request as unknown as { cf?: { asn?: number } }).cf?.asn,
  };

  try {
    await fetch(env.TRUSTDATA_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.TRUSTDATA_API_KEY,
      },
      body: JSON.stringify([log]),
    });
  } catch (err) {
    // Swallow errors — the customer's response must not depend on our ingest.
    console.error("trustdata log forward failed:", err);
  }
}

/**
 * Serve the signed WebMCP manifest at /.well-known/webmcp.json.
 *
 * Flow: KV cache → upstream Django → fallthrough. The manifest itself
 * carries an Ed25519 signature, so downstream caches (KV, CDN, browsers)
 * never need to be trusted — agents verify the signature independently.
 */
export async function serveWebmcpManifest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.TRUSTDATA_MANIFEST_URL || !env.TRUSTDATA_ATTRIBUTION_ID) {
    // Feature disabled — fall through so customer origin (if any) handles it,
    // otherwise Cloudflare returns its default 404.
    return fetch(request);
  }

  const cacheKey = `${WEBMCP_CACHE_KEY_PREFIX}${env.TRUSTDATA_ATTRIBUTION_ID}`;

  if (env.WEBMCP_CACHE) {
    const cached = await env.WEBMCP_CACHE.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${WEBMCP_CACHE_TTL_SECONDS}`,
          "X-TrustData-Cache": "hit",
        },
      });
    }
  }

  const upstreamUrl = buildManifestUrl(
    env.TRUSTDATA_MANIFEST_URL,
    env.TRUSTDATA_ATTRIBUTION_ID,
  );

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    console.error("trustdata webmcp fetch failed:", err);
    return new Response(
      JSON.stringify({ error: "Manifest upstream unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  if (upstream.status === 404) {
    return new Response(JSON.stringify({ error: "No manifest configured" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: "Manifest upstream error" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await upstream.text();

  if (env.WEBMCP_CACHE) {
    ctx.waitUntil(
      env.WEBMCP_CACHE.put(cacheKey, body, {
        expirationTtl: WEBMCP_CACHE_TTL_SECONDS,
      }),
    );
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${WEBMCP_CACHE_TTL_SECONDS}`,
      "X-TrustData-Cache": "miss",
    },
  });
}

/**
 * Resolve the upstream manifest URL. `TRUSTDATA_MANIFEST_URL` may be either:
 *   - A full URL including `<attribution_id>` or `{attribution_id}` placeholder
 *   - A base URL (no placeholder) — the attribution ID is appended as a path segment
 *
 * Exported for tests.
 */
export function buildManifestUrl(
  template: string,
  attributionId: string,
): string {
  if (template.includes("<attribution_id>")) {
    return template.replace("<attribution_id>", attributionId);
  }
  if (template.includes("{attribution_id}")) {
    return template.replace("{attribution_id}", attributionId);
  }
  const trimmed = template.replace(/\/+$/, "");
  return `${trimmed}/${attributionId}/manifest/`;
}
