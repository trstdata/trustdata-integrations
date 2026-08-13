# @trustdata/ai-bot-collector

The Cloudflare Worker behind [TrustData](https://trustdata.tech)'s AI-crawler analytics. It runs
as middleware on your zone, classifies every request at the edge, and forwards only AI-bot hits,
AI-engine referrals and a small anonymized traffic sample to TrustData. Everything else never
leaves your zone. It also hosts your signed [WebMCP](https://www.w3.org/TR/webmcp/) manifest at
`/.well-known/webmcp.json`.

## You probably don't want to install this by hand

This package is the Worker's source. The supported way to deploy it is the **Deploy to Cloudflare**
button, which creates a small configuration repo in your Git account that depends on this package
and deploys it for you:

**→ [Deploy the AI bot collector](https://github.com/trstdata/trustdata-integrations/tree/main/cloudflare/ai-bot-collector)**

Setup, configuration and upgrade instructions live in the
[TrustData docs](https://docs.trustdata.tech/connectors/cloudflare-ai-crawlers).

## Using it directly

If you maintain your own Worker project, point Wrangler's `main` at this package:

```jsonc
// wrangler.jsonc
{
  "name": "ai-bot-collector",
  "main": "@trustdata/ai-bot-collector",
  "compatibility_date": "2026-01-01",
  "vars": {
    "TRUSTDATA_INGEST_URL": "https://t.trustdata.tech/v1/logs/cloudflare_worker",
    "TRUSTDATA_ATTRIBUTION_ID": "<your attribution ID>"
  }
}
```

`TRUSTDATA_API_KEY` should be a Worker **secret**, not a plaintext var. The full variable
reference is in the [docs](https://docs.trustdata.tech/connectors/cloudflare-ai-crawlers).

The package also exports its internals (`forwardLog`, `classifyRequest`, `verifySignature`, …) if
you need to compose the collector into a larger Worker.

## Development

Source of truth is
[`cloudflare/ai-bot-collector-src/`](https://github.com/trstdata/trustdata-integrations/tree/main/cloudflare/ai-bot-collector-src)
in the `trstdata/trustdata-integrations` monorepo. Releases are published from that repo's CI with
npm provenance.

## License

MIT
