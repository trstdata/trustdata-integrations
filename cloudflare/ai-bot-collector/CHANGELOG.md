# Changelog

## 0.3.0

**Fix: AI bots whose vendor publishes no IP list are no longer marked as spoofed.**

The edge anti-spoof check matched the client IP against the union of the vendor
ranges we hold (OpenAI / Google / Perplexity) and stamped `verified=false` for
any bot whose IP wasn't in that union. Bots from vendors that publish no IP list
at all (Anthropic/ClaudeBot, Meta, ByteDance, …) can never be in it, so they were
flagged as spoofs when the honest verdict is "unknown".

- IP-verification now runs only for vendors that publish a range list; every
  other bot leaves its verdict unset (unknown) instead of a false negative.
- The set of verifiable vendors is now synced from TrustData
  (`verifiable_engines` in `/v1/config/ai-bots`), not hardcoded — so adding a
  vendor's range list reaches deployed Workers via the existing 6h sync with no
  redeploy. The embedded list is an offline cold-start fallback only.
- Raw IP is still dropped for every bot; real spoofs (e.g. a fake GPTBot from a
  non-OpenAI IP) are still caught.

> **Updating:** sync your fork and let Cloudflare redeploy. This is the last
> verification-logic redeploy you'll need — future verifiable-vendor changes
> propagate automatically via config sync.

## 0.2.0

Initial public release: edge AI-bot classification, anonymized traffic sampling,
runtime bot-list sync, RFC 9421 signature verification, and WebMCP manifest hosting.
