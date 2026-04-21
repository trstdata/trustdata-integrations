#!/usr/bin/env bash
# Post-deploy smoke test for the Cloudflare AI-crawler ingest endpoint.
#
# Not wired into CI — run manually after a staging/prod deploy to confirm
# the full path is alive:
#   1. Worker endpoint accepts a known AI-bot payload          → 204
#   2. Worker endpoint accepts an AI-referrer payload          → 204
#   3. Worker endpoint accepts non-AI traffic (still 204)      → 204 (dropped server-side)
#   4. Worker endpoint rejects a bogus API key                 → 401
#   5. Logpush endpoint accepts an NDJSON line via query-param → 204
#
# ClickHouse assertions are out of scope here — the Go integration test in
# handler_cloudflare_integration_test.go already covers the persistence
# path. Eyeball the dashboard's AI Visibility tab after running to confirm
# the bot visits show up.
#
# Usage:
#   TRUSTDATA_INGEST_HOST=https://t.trustdata.tech \
#   TRUSTDATA_API_KEY=td_cf_... \
#   TRUSTDATA_ATTRIBUTION_ID=<property-uuid> \
#   ./smoke.sh

set -euo pipefail

: "${TRUSTDATA_INGEST_HOST:=https://t.trustdata.tech}"
: "${TRUSTDATA_API_KEY:?set TRUSTDATA_API_KEY to a td_cf_ key from /settings/data-sources/}"
: "${TRUSTDATA_ATTRIBUTION_ID:?set TRUSTDATA_ATTRIBUTION_ID to a property UUID}"

WORKER_URL="${TRUSTDATA_INGEST_HOST}/v1/logs/cloudflare_worker"
LOGPUSH_URL="${TRUSTDATA_INGEST_HOST}/v1/logs/cloudflare_logpush"
NOW_MS=$(date +%s)000

pass=0
fail=0

# Each case: name | url | method | headers | body | expected_status
check() {
  local name=$1 url=$2 method=$3 api_key=$4 body=$5 expected=$6

  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X "$method" "$url" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $api_key" \
    --data "$body" || true)

  if [[ "$status" == "$expected" ]]; then
    printf '  ok  %-55s  [%s]\n' "$name" "$status"
    pass=$((pass + 1))
  else
    printf '  FAIL %-55s  [got %s, want %s]\n' "$name" "$status" "$expected"
    fail=$((fail + 1))
  fi
}

echo "Smoke-testing Cloudflare ingest at $TRUSTDATA_INGEST_HOST"
echo

# ---- Worker endpoint ----
check "1. Worker / GPTBot → bot_visit" "$WORKER_URL" POST "$TRUSTDATA_API_KEY" \
  "[{
    \"timestamp\": $NOW_MS,
    \"attribution_id\": \"$TRUSTDATA_ATTRIBUTION_ID\",
    \"host\": \"smoke.trustdata.tech\",
    \"method\": \"GET\",
    \"pathname\": \"/smoke/bot\",
    \"user_agent\": \"Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)\",
    \"referer\": \"\",
    \"status\": 200
  }]" \
  "204"

check "2. Worker / Perplexity referrer → referral_visit" "$WORKER_URL" POST "$TRUSTDATA_API_KEY" \
  "[{
    \"timestamp\": $NOW_MS,
    \"attribution_id\": \"$TRUSTDATA_ATTRIBUTION_ID\",
    \"host\": \"smoke.trustdata.tech\",
    \"method\": \"GET\",
    \"pathname\": \"/smoke/referral\",
    \"user_agent\": \"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)\",
    \"referer\": \"https://www.perplexity.ai/search?q=trustdata\",
    \"status\": 200
  }]" \
  "204"

check "3. Worker / non-AI traffic → 204 (dropped)" "$WORKER_URL" POST "$TRUSTDATA_API_KEY" \
  "[{
    \"timestamp\": $NOW_MS,
    \"attribution_id\": \"$TRUSTDATA_ATTRIBUTION_ID\",
    \"host\": \"smoke.trustdata.tech\",
    \"method\": \"GET\",
    \"pathname\": \"/smoke/drop\",
    \"user_agent\": \"Mozilla/5.0 (human browser)\",
    \"referer\": \"https://google.com/search?q=foo\",
    \"status\": 200
  }]" \
  "204"

check "4. Worker / invalid API key → 401" "$WORKER_URL" POST "td_cf_definitely_bogus" \
  "[]" \
  "401"

# ---- Logpush endpoint (NDJSON, API key in query param) ----
LOGPUSH_URL_AUTHED="${LOGPUSH_URL}?header_X-API-Key=${TRUSTDATA_API_KEY}&attribution_id=${TRUSTDATA_ATTRIBUTION_ID}"
status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$LOGPUSH_URL_AUTHED" \
  -H "Content-Type: application/x-ndjson" \
  --data "{\"EdgeStartTimestamp\":$(date +%s%N),\"ClientRequestHost\":\"smoke.trustdata.tech\",\"ClientRequestURI\":\"/smoke/logpush\",\"ClientRequestUserAgent\":\"ClaudeBot/1.0\",\"ClientRequestReferer\":\"\",\"ClientRequestMethod\":\"GET\",\"ClientIP\":\"1.2.3.4\",\"EdgeResponseStatus\":200}" \
  || true)

if [[ "$status" == "204" ]]; then
  printf '  ok  %-55s  [%s]\n' "5. Logpush / ClaudeBot NDJSON → bot_visit" "$status"
  pass=$((pass + 1))
else
  printf '  FAIL %-55s  [got %s, want 204]\n' "5. Logpush / ClaudeBot NDJSON → bot_visit" "$status"
  fail=$((fail + 1))
fi

echo
echo "Results: $pass passed, $fail failed."
echo
echo "Next: open the dashboard → AI Visibility tab → confirm smoke.trustdata.tech"
echo "hits from GPTBot / ClaudeBot appear within ~60s. The dbt mart refresh is"
echo "daily, so int_ai_crawl_unified won't pick these up until the next run."

exit $fail
