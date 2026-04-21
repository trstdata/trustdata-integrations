# TrustData AI Bot Collector — Cloudflare Worker

Customer-deployed Cloudflare Worker with two jobs:

1. **AI-bot observability** — forwards every HTTP request the customer's
   zone serves to TrustData's ingest endpoint so the Go server can
   classify AI crawlers (GPTBot, PerplexityBot, ClaudeBot…) and AI-engine
   referrals.
2. **WebMCP manifest hosting** — serves the signed WebMCP manifest at
   `/.well-known/webmcp.json` so AI agents can discover your site's
   tool surface before loading any page.

**Why a Worker?** The TrustData JS SDK only catches bots that load the tracker.
AI crawlers hit `/robots.txt`, `/sitemap.xml`, and raw HTML endpoints that
bypass JS. Cloudflare sits in front of 100% of zone traffic, so it sees
every bot hit.

Classification happens server-side — new bots get captured retroactively
without re-deploying the Worker.

## Quick start

```bash
cd cloud/cloudflare/ai-bot-collector
npm install

# 1. Edit wrangler.jsonc — replace `example.com` with your domain
# 2. Set the attribution_id var (your TrustData property UUID)
# 3. Put the API key as a secret (get it from /settings/data-sources/)
npx wrangler secret put TRUSTDATA_API_KEY

# 4. Deploy
npx wrangler deploy
```

## Configuration

| Variable | Type | Purpose |
|----------|------|---------|
| `TRUSTDATA_INGEST_URL` | var | HTTPS endpoint (pre-filled to `https://t.trustdata.tech/v1/logs/cloudflare_worker`) |
| `TRUSTDATA_ATTRIBUTION_ID` | var | Your TrustData property UUID — tags events + keys the WebMCP manifest |
| `TRUSTDATA_API_KEY` | **secret** | Auth key issued on `/settings/data-sources/` → Cloudflare → Worker tab |
| `TRUSTDATA_MANIFEST_URL` | var *(optional)* | Base URL for the WebMCP manifest API. Pre-filled to `https://app.trustdata.tech/api/v1/webmcp` — leave blank to disable manifest hosting |
| `WEBMCP_CACHE` | KV binding *(optional)* | Edge cache for the signed manifest (1-hour TTL). Create with `wrangler kv:namespace create webmcp_cache` |

## Testing

```bash
npm test   # Vitest unit tests — no Cloudflare account needed
```

## How it works

### AI-bot ingestion

1. Worker wraps every request via `fetch(request)`.
2. Clones the response so the body size and headers can be introspected
   without consuming the stream the user sees.
3. Builds a log entry: timestamp, host, path, user agent, referer, IP,
   country, status code, bytes.
4. Fires-and-forgets a JSON POST to TrustData's ingest endpoint.
5. Returns the original response to the user — our work is invisible.

The TrustData Go server (`tracking/server/internal/adapter/http/handler_cloudflare.go`)
authenticates the `X-API-Key` header, then classifies each log line into one of:

- `cloudflare_bot_visit` — UA matches a known AI crawler (GPTBot, PerplexityBot, ClaudeBot, …)
- `cloudflare_referral_visit` — referrer is an AI engine (chatgpt.com, perplexity.ai, claude.ai, …) + UA is human
- `<dropped>` — everything else

Events feed ClickHouse materialized views (`cloudflare_bot_activity`,
`cloudflare_referral_activity`), which dbt unions with the SDK-observed
`ai_crawler_activity` in `int_ai_crawl_unified`.

### WebMCP manifest hosting

1. Agent (or browser) requests `/.well-known/webmcp.json` on your zone.
2. Worker checks KV for a cached copy keyed by attribution ID
   (`webmcp:v1:<id>`, 1-hour TTL).
3. On miss, Worker fetches `TRUSTDATA_MANIFEST_URL/<id>/manifest/` from
   the TrustData API and caches the body.
4. Response is returned with `Content-Type: application/json` and
   `Cache-Control: public, max-age=3600`.
5. Agent verifies the Ed25519 signature inside the body against the
   embedded `public_key` and invokes the declared tools.

You edit the tool list + rotate signing keys in TrustData (Settings →
Property → WebMCP). Updates propagate on the next cache miss (≤1 hour), or
instantly after a manual key rotation that invalidates the cached
signature.
