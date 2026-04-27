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

## Quick start — 1-click deploy (recommended)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/trstdata/trustdata-integrations/tree/main/cloudflare/ai-bot-collector)

The Deploy to Cloudflare button walks you through the whole setup in your browser — no terminal, no `wrangler login`, no `npm install`. You'll need:

1. A TrustData account → issue an ingest key in `/organizations/<org_id>/#integrations` (provider: Cloudflare). Copy the `td_live_…` value.
2. Your TrustData property UUID (visible on the property page).
3. A Cloudflare account with a zone you control.

The button will:
- Clone this repo into your GitHub or GitLab account
- Prompt for `TRUSTDATA_API_KEY`, `TRUSTDATA_ATTRIBUTION_ID`, and the KV namespace name
- Auto-provision the KV namespace
- Deploy the Worker

### After deploy: configure the Worker route

The Worker isn't intercepting traffic yet — it's deployed but unrouted. In your Cloudflare dashboard:

1. **Workers & Pages → `trustdata-ai-bot-collector` → Settings → Triggers → Add Custom Domain or Route**
2. Pick your zone (`yourdomain.com`)
3. Pattern: `*.yourdomain.com/*` (catches subdomains too) — adjust to your traffic shape

The Worker now wraps every request your zone serves and fires AI-bot logs to TrustData fire-and-forget.

### Hardening: convert API key to a secret (post-deploy, optional)

The Deploy button stores `TRUSTDATA_API_KEY` as a regular env variable so it can be filled in via the UI. For production, swap it to a secret so it's hidden from the dashboard:

1. Cloudflare dashboard → Workers & Pages → `trustdata-ai-bot-collector` → **Settings** → **Variables and Secrets**
2. Edit `TRUSTDATA_API_KEY` → change Type to **Secret** → Save

The Worker reads `env.TRUSTDATA_API_KEY` either way; the binding is identical at runtime.

## Alternative — Logpush (if your Cloudflare plan includes it)

Cloudflare **Logpush** can stream HTTP request logs directly to TrustData with **zero code on your side** — no Worker to maintain. Logpush availability depends on your Cloudflare plan (historically Enterprise; some Pro/Business plans now include it). Check your zone's **Analytics & Logs → Logpush** menu — if it's there, you can use this path.

Setup (~5 min, all in the Cloudflare dashboard):

1. Issue a TrustData ingest key in `/organizations/<org_id>/#integrations` (provider: Cloudflare). Copy the `td_live_…` value.
2. Cloudflare dashboard → your zone → **Analytics & Logs → Logpush → Create job**.
3. **Destination type:** HTTP destination.
4. **Destination URL:**
   ```
   https://t.trustdata.tech/v1/logs/cloudflare_logpush?header_X-API-Key=td_live_YOUR_KEY&tags=attribution_id=YOUR_PROPERTY_UUID
   ```
5. **Dataset:** HTTP requests.
6. **Fields:** Push all logs, or filter to `EdgeStartTimestamp`, `ClientRequestUserAgent`, `ClientRequestReferer`, `ClientRequestPath`, `ClientRequestHost`, `EdgeResponseStatus` to reduce volume.
7. Click Save. Logs start flowing within a minute.

Logpush hits the Go server's `/v1/logs/cloudflare_logpush` endpoint (NDJSON). Same classification logic as the Worker path — same ClickHouse output. No Worker, no KV namespace, no `wrangler` CLI.

## Quick start — CLI (advanced)

```bash
cd cloud/cloudflare/ai-bot-collector
npm install

# 1. Edit wrangler.jsonc — set `route` to your zone, set TRUSTDATA_ATTRIBUTION_ID
# 2. Deploy first (creates the Worker)
npx wrangler deploy

# 3. Add the API key as a secret (get it from /organizations/<org_id>/#integrations)
npx wrangler secret put TRUSTDATA_API_KEY
```

## Configuration

| Variable | Type | Purpose |
|----------|------|---------|
| `TRUSTDATA_INGEST_URL` | var | HTTPS endpoint (pre-filled to `https://t.trustdata.tech/v1/logs/cloudflare_worker`) |
| `TRUSTDATA_ATTRIBUTION_ID` | var | Your TrustData property UUID — tags events + keys the WebMCP manifest |
| `TRUSTDATA_API_KEY` | var (or secret post-deploy) | Auth key issued on `/organizations/<org_id>/#integrations` → Cloudflare. The Deploy button uses a var so it can prompt for it; convert to a secret after deploy for hardening (see above). |
| `TRUSTDATA_MANIFEST_URL` | var *(optional)* | Base URL for the WebMCP manifest API. Pre-filled to `https://app.trustdata.tech/api/v1/webmcp` — leave blank to disable manifest hosting |
| `WEBMCP_CACHE` | KV binding *(optional)* | Edge cache for the signed manifest (1-hour TTL). Auto-provisioned by the Deploy button, or `wrangler kv namespace create webmcp_cache` for the CLI path |

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
