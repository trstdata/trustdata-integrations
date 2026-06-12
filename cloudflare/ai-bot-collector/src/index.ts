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
 * Classification happens at the edge so the customer's zone only ships AI
 * traffic to TrustData, never its visitors:
 *
 *   - UA matches a known AI bot, or referer matches an AI engine → forwarded
 *     in full fidelity. The server re-runs its own (possibly newer) classifier.
 *   - Everything else → a small random sample (TRUSTDATA_SAMPLE_RATE, default
 *     2%) is forwarded in anonymized form — IP truncated, query params dropped,
 *     referer reduced to its host — tagged with `sample_rate` so the server can
 *     weight it back into traffic-share metrics. The sample is also how bots
 *     missing from the edge lists below still reach the server-side classifier.
 *   - TRUSTDATA_FORWARD_ALL="true" disables edge filtering entirely (opt-in
 *     full-take for customers with a DPA covering visitor-level data).
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
  // Fraction (0–1, as a string) of non-AI traffic forwarded as anonymized
  // samples. Unset → DEFAULT_SAMPLE_RATE. "0" disables sampling.
  TRUSTDATA_SAMPLE_RATE?: string;
  // Endpoint serving the canonical AI bot list (see /v1/config/ai-bots on the
  // TrustData collector). When set, the Worker syncs its edge lists from it
  // (in-memory + KV cache) so new bots are matched in full fidelity without a
  // re-deploy. Unset or unreachable → the embedded lists below.
  TRUSTDATA_BOTLIST_URL?: string;
  // "true" → forward every request unfiltered (legacy behavior). Requires a
  // DPA with TrustData since full traffic includes visitor personal data.
  TRUSTDATA_FORWARD_ALL?: string;
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
  // Present only on anonymized sample entries: the probability this request
  // was forwarded with. The server weights the event by 1/sample_rate.
  sample_rate?: number;
}

// ── Edge classification ─────────────────────────────────────────────────────
// Mirrors the server's lists (trustdata-cloud: enrichment.AIBotUserAgents and
// DomainSourceCategoryMapping[SOURCE_CATEGORY_AI]). The server re-classifies
// every forwarded event with its own copy, so a stale list here only affects
// what gets sampled vs. fully forwarded — never what gets counted as a bot.

// Lowercase substrings matched against the lowercased UA — vendors are
// inconsistent about casing (Meta ships "meta-externalagent/1.1"). The edge
// only decides "AI or not"; the server assigns the canonical bot name and
// intent (training / search / on_demand).
export const AI_BOT_USER_AGENTS = [
  // OpenAI
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  // Anthropic
  "claudebot",
  "claude-searchbot",
  "claude-user",
  "claude-web",    // deprecated, residual traffic
  "anthropic-ai",  // deprecated, residual traffic
  // Perplexity
  "perplexitybot",
  "perplexity-user",
  // Google ("Google-Extended" is a robots.txt token, never a UA)
  "googleother",
  "google-cloudvertexbot",
  "google-notebooklm",
  "gemini-deep-research",
  // Meta
  "meta-externalagent",
  "meta-externalfetcher",
  "meta-webindexer",
  // Mistral
  "mistralai-user",
  "mistralai-index",
  // Amazon
  "amazonbot",
  "amzn-searchbot",
  "amzn-user",
  "agent-novaact",
  // ByteDance
  "bytespider",
  "tiktokspider",
  // Cohere
  "cohere-training-data-crawler",
  "cohere-ai",
  // Others
  "youbot",
  "duckassistbot",
  "petalbot",
  "pangubot",
  "deepseekbot",
  "ccbot",
];

export const AI_REFERRER_DOMAINS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "perplexity.ai",
  "claude.ai",
  "anthropic.com",
  "copilot.microsoft.com",
  "copilot.com",
  "gemini.google.com",
  "bard.google.com",
  "you.com",
  "phind.com",
  "poe.com",
  "character.ai",
  "pi.ai",
  "mistral.ai",
  "chat.mistral.ai",
  "le-chat.mistral.ai",
  "huggingface.co",
  "cohere.com",
  "coral.cohere.com",
  "kagi.com",
  "meta.ai",
  "groq.com",
  "deepseek.com",
  "chat.deepseek.com",
]);

export const DEFAULT_SAMPLE_RATE = 0.02;

export type EdgeMatch = "bot" | "referral" | null;

export interface BotLists {
  patterns: string[];
  referrerDomains: Set<string>;
}

export const EMBEDDED_BOT_LISTS: BotLists = {
  patterns: AI_BOT_USER_AGENTS,
  referrerDomains: AI_REFERRER_DOMAINS,
};

// ── Bot list sync ────────────────────────────────────────────────────────────
// The embedded lists above are a fallback snapshot. When TRUSTDATA_BOTLIST_URL
// is configured, the Worker syncs the canonical lists from the TrustData
// collector (single source of truth: enrichment.AIBotPatterns in Go), so
// customer Workers pick up new bots without anyone re-deploying.
//
// Three tiers: per-isolate memory (10 min) → KV (6 h, shared across isolates)
// → upstream fetch. Any failure falls back to the embedded lists; a stale list
// is harmless because missed bots still reach the server via the weighted
// sample and are classified there.

export const BOTLIST_CACHE_KEY = "aibots:v1";
export const BOTLIST_KV_TTL_SECONDS = 21600; // 6 h
export const BOTLIST_MEMORY_TTL_MS = 10 * 60 * 1000;

let botListCache: { lists: BotLists; fetchedAt: number } | null = null;

// Test hook — isolates the module-level cache between test cases.
export function _resetBotListCache(): void {
  botListCache = null;
}

export async function getBotLists(env: Env): Promise<BotLists> {
  if (!env.TRUSTDATA_BOTLIST_URL) {
    return EMBEDDED_BOT_LISTS;
  }
  if (botListCache && Date.now() - botListCache.fetchedAt < BOTLIST_MEMORY_TTL_MS) {
    return botListCache.lists;
  }

  try {
    if (env.WEBMCP_CACHE) {
      const cached = await env.WEBMCP_CACHE.get(BOTLIST_CACHE_KEY);
      const lists = cached ? parseBotLists(cached) : null;
      if (lists) {
        botListCache = { lists, fetchedAt: Date.now() };
        return lists;
      }
    }

    const resp = await fetch(env.TRUSTDATA_BOTLIST_URL, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`bot list upstream returned ${resp.status}`);
    }
    const raw = await resp.text();
    const lists = parseBotLists(raw);
    if (!lists) {
      throw new Error("bot list upstream returned an invalid shape");
    }
    if (env.WEBMCP_CACHE) {
      // Store the upstream body verbatim — one parser for both tiers. We're
      // already running under waitUntil, so awaiting the put is safe.
      await env.WEBMCP_CACHE.put(BOTLIST_CACHE_KEY, raw, {
        expirationTtl: BOTLIST_KV_TTL_SECONDS,
      });
    }
    botListCache = { lists, fetchedAt: Date.now() };
    return lists;
  } catch (err) {
    console.error("trustdata bot list sync failed, using embedded lists:", err);
    // Cache the fallback too — don't hammer a broken upstream on every request.
    botListCache = { lists: EMBEDDED_BOT_LISTS, fetchedAt: Date.now() };
    return EMBEDDED_BOT_LISTS;
  }
}

// Accepts the /v1/config/ai-bots response shape. Returns null when the shape
// is unusable (so callers fall back rather than match nothing).
function parseBotLists(raw: string): BotLists | null {
  try {
    const body = JSON.parse(raw) as {
      bot_patterns?: Array<{ pattern?: unknown }>;
      ai_referrer_domains?: unknown[];
    };
    if (!Array.isArray(body.bot_patterns)) {
      return null;
    }
    const patterns = body.bot_patterns
      .map((e) => (typeof e.pattern === "string" ? e.pattern.toLowerCase() : ""))
      .filter(Boolean);
    if (patterns.length === 0) {
      return null;
    }
    const referrerDomains = new Set(
      (Array.isArray(body.ai_referrer_domains) ? body.ai_referrer_domains : [])
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.toLowerCase()),
    );
    // A response without referrer domains is suspicious — keep the embedded set.
    return {
      patterns,
      referrerDomains: referrerDomains.size > 0 ? referrerDomains : AI_REFERRER_DOMAINS,
    };
  } catch {
    return null;
  }
}

export function classifyRequest(
  userAgent: string | null,
  referer: string | null,
  lists: BotLists = EMBEDDED_BOT_LISTS,
): EdgeMatch {
  if (userAgent) {
    const lower = userAgent.toLowerCase();
    for (const pattern of lists.patterns) {
      if (lower.includes(pattern)) {
        return "bot";
      }
    }
  }
  if (isAIReferrer(referer, lists.referrerDomains)) {
    return "referral";
  }
  return null;
}

// Same semantics as the server: lowercase, strip "www.", then progressively
// strip leading labels so "fr.claude.ai" matches the "claude.ai" entry.
function isAIReferrer(referer: string | null, domains: Set<string>): boolean {
  let host = refererHost(referer);
  if (!host) {
    return false;
  }
  host = host.replace(/^www\./, "");
  for (let h = host; h; ) {
    if (domains.has(h)) {
      return true;
    }
    const dot = h.indexOf(".");
    h = dot >= 0 && dot < h.length - 1 ? h.slice(dot + 1) : "";
  }
  return false;
}

export function refererHost(referer: string | null): string | null {
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).hostname.toLowerCase();
  } catch {
    // Not a full URL — Referer is occasionally sent as a bare host.
    const bare = referer.split(/[/?#]/)[0].toLowerCase();
    return bare || null;
  }
}

// Truncate to IPv4 /24 or IPv6 /48 — coarse enough to drop the personal-data
// quality, fine enough to keep per-network behavioral signals in samples.
export function anonymizeIp(ip: string | null): string | null {
  if (!ip) {
    return null;
  }
  if (ip.includes(":")) {
    const groups = ip.split(":");
    return `${groups.slice(0, 3).join(":")}::`;
  }
  const octets = ip.split(".");
  if (octets.length !== 4) {
    return null;
  }
  octets[3] = "0";
  return octets.join(".");
}

export function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_SAMPLE_RATE;
  }
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0) {
    return DEFAULT_SAMPLE_RATE;
  }
  return Math.min(rate, 1);
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

  const userAgent = request.headers.get("user-agent");
  const referer = request.headers.get("referer");
  const lists = await getBotLists(env);
  const match = classifyRequest(userAgent, referer, lists);
  const forwardAll = env.TRUSTDATA_FORWARD_ALL === "true";

  let sampleRate: number | undefined;
  if (!match && !forwardAll) {
    sampleRate = parseSampleRate(env.TRUSTDATA_SAMPLE_RATE);
    if (sampleRate <= 0 || Math.random() >= sampleRate) {
      return; // The common case: non-AI traffic, not sampled — nothing leaves the zone.
    }
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
    user_agent: userAgent,
    referer: referer,
    bytes: headerSize + responseBody.size,
    status: response.status,
    country: (request as unknown as { cf?: { country?: string } }).cf?.country,
    asn: (request as unknown as { cf?: { asn?: number } }).cf?.asn,
  };

  if (sampleRate !== undefined) {
    // Anonymized sample: keep what baseline/bot-discovery needs (UA, path,
    // truncated network, country/ASN), drop what identifies the visitor.
    log.ip = anonymizeIp(log.ip);
    log.query_params = {};
    log.referer = refererHost(referer);
    log.sample_rate = sampleRate;
  }

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
