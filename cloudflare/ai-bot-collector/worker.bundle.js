var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var AI_BOT_USER_AGENTS = [
  // OpenAI
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  // Anthropic
  "claudebot",
  "claude-searchbot",
  "claude-user",
  "claude-web",
  // deprecated, residual traffic
  "anthropic-ai",
  // deprecated, residual traffic
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
  "ccbot"
];
var AI_REFERRER_DOMAINS = /* @__PURE__ */ new Set([
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
  "chat.deepseek.com"
]);
var DEFAULT_SAMPLE_RATE = 0.02;
var EMBEDDED_BOT_LISTS = {
  patterns: AI_BOT_USER_AGENTS,
  referrerDomains: AI_REFERRER_DOMAINS
};
var BOTLIST_CACHE_KEY = "aibots:v1";
var BOTLIST_KV_TTL_SECONDS = 21600;
var BOTLIST_MEMORY_TTL_MS = 10 * 60 * 1e3;
var botListCache = null;
function _resetBotListCache() {
  botListCache = null;
}
__name(_resetBotListCache, "_resetBotListCache");
async function getBotLists(env) {
  if (!env.TRUSTDATA_BOTLIST_URL) {
    return EMBEDDED_BOT_LISTS;
  }
  if (botListCache && Date.now() - botListCache.fetchedAt < BOTLIST_MEMORY_TTL_MS) {
    return botListCache.lists;
  }
  try {
    if (env.WEBMCP_CACHE) {
      const cached = await env.WEBMCP_CACHE.get(BOTLIST_CACHE_KEY);
      const lists2 = cached ? parseBotLists(cached) : null;
      if (lists2) {
        botListCache = { lists: lists2, fetchedAt: Date.now() };
        return lists2;
      }
    }
    const resp = await fetch(env.TRUSTDATA_BOTLIST_URL, {
      headers: { Accept: "application/json" }
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
      await env.WEBMCP_CACHE.put(BOTLIST_CACHE_KEY, raw, {
        expirationTtl: BOTLIST_KV_TTL_SECONDS
      });
    }
    botListCache = { lists, fetchedAt: Date.now() };
    return lists;
  } catch (err) {
    console.error("trustdata bot list sync failed, using embedded lists:", err);
    botListCache = { lists: EMBEDDED_BOT_LISTS, fetchedAt: Date.now() };
    return EMBEDDED_BOT_LISTS;
  }
}
__name(getBotLists, "getBotLists");
function parseBotLists(raw) {
  try {
    const body = JSON.parse(raw);
    if (!Array.isArray(body.bot_patterns)) {
      return null;
    }
    const patterns = body.bot_patterns.map((e) => typeof e.pattern === "string" ? e.pattern.toLowerCase() : "").filter(Boolean);
    if (patterns.length === 0) {
      return null;
    }
    const referrerDomains = new Set(
      (Array.isArray(body.ai_referrer_domains) ? body.ai_referrer_domains : []).filter((d) => typeof d === "string").map((d) => d.toLowerCase())
    );
    return {
      patterns,
      referrerDomains: referrerDomains.size > 0 ? referrerDomains : AI_REFERRER_DOMAINS
    };
  } catch {
    return null;
  }
}
__name(parseBotLists, "parseBotLists");
function classifyRequest(userAgent, referer, lists = EMBEDDED_BOT_LISTS) {
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
__name(classifyRequest, "classifyRequest");
function isAIReferrer(referer, domains) {
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
__name(isAIReferrer, "isAIReferrer");
function refererHost(referer) {
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).hostname.toLowerCase();
  } catch {
    const bare = referer.split(/[/?#]/)[0].toLowerCase();
    return bare || null;
  }
}
__name(refererHost, "refererHost");
function anonymizeIp(ip) {
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
__name(anonymizeIp, "anonymizeIp");
function parseSampleRate(raw) {
  if (raw === void 0 || raw === "") {
    return DEFAULT_SAMPLE_RATE;
  }
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0) {
    return DEFAULT_SAMPLE_RATE;
  }
  return Math.min(rate, 1);
}
__name(parseSampleRate, "parseSampleRate");
var BOT_IP_RANGE_URLS = [
  "https://openai.com/gptbot.json",
  "https://openai.com/searchbot.json",
  "https://openai.com/chatgpt-user.json",
  "https://developers.google.com/static/search/apis/ipranges/googlebot.json",
  "https://developers.google.com/static/search/apis/ipranges/special-crawlers.json",
  "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers-google.json",
  "https://www.perplexity.com/perplexitybot.json",
  "https://www.perplexity.com/perplexity-user.json"
];
var VERIFIABLE_BOT_UAS = [
  // OpenAI
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  // Google
  "googleother",
  "google-cloudvertexbot",
  "google-notebooklm",
  "gemini-deep-research",
  // Perplexity
  "perplexitybot",
  "perplexity-user"
];
function isVerifiableBotUA(userAgent) {
  if (!userAgent) {
    return false;
  }
  const lower = userAgent.toLowerCase();
  return VERIFIABLE_BOT_UAS.some((ua) => lower.includes(ua));
}
__name(isVerifiableBotUA, "isVerifiableBotUA");
var BOTIP_CACHE_KEY = "aibotips:v1";
var BOTIP_KV_TTL_SECONDS = 21600;
var BOTIP_MEMORY_TTL_MS = 10 * 60 * 1e3;
var botIPCache = null;
function _resetBotIPCache() {
  botIPCache = null;
}
__name(_resetBotIPCache, "_resetBotIPCache");
function ipToBigInt(ip) {
  if (ip.includes(":")) {
    const halves = ip.split("::");
    if (halves.length > 2) {
      return null;
    }
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0 || halves.length === 1 && head.length !== 8) {
      return null;
    }
    const groups = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
    if (groups.length !== 8) {
      return null;
    }
    let value2 = 0n;
    for (const g of groups) {
      const n = parseInt(g || "0", 16);
      if (Number.isNaN(n) || n < 0 || n > 65535 || !/^[0-9a-fA-F]{1,4}$/.test(g || "0")) {
        return null;
      }
      value2 = value2 << 16n | BigInt(n);
    }
    return { value: value2, v6: true };
  }
  const octets = ip.split(".");
  if (octets.length !== 4) {
    return null;
  }
  let value = 0n;
  for (const o of octets) {
    const n = Number(o);
    if (!Number.isInteger(n) || n < 0 || n > 255 || !/^\d{1,3}$/.test(o)) {
      return null;
    }
    value = value << 8n | BigInt(n);
  }
  return { value, v6: false };
}
__name(ipToBigInt, "ipToBigInt");
function parseCidr(cidr) {
  const slash = cidr.indexOf("/");
  if (slash < 0) {
    return null;
  }
  const parsed = ipToBigInt(cidr.slice(0, slash));
  if (!parsed) {
    return null;
  }
  const bits = Number(cidr.slice(slash + 1));
  const width = parsed.v6 ? 128 : 32;
  if (!Number.isInteger(bits) || bits < 0 || bits > width) {
    return null;
  }
  const full = (1n << BigInt(width)) - 1n;
  const mask = bits === 0 ? 0n : full << BigInt(width - bits) & full;
  return { base: parsed.value & mask, mask, v6: parsed.v6 };
}
__name(parseCidr, "parseCidr");
function ipInRanges(ip, ranges) {
  if (!ip) {
    return false;
  }
  const parsed = ipToBigInt(ip);
  if (!parsed) {
    return false;
  }
  for (const r of ranges) {
    if (r.v6 === parsed.v6 && (parsed.value & r.mask) === r.base) {
      return true;
    }
  }
  return false;
}
__name(ipInRanges, "ipInRanges");
async function getBotIPRanges(env) {
  if (botIPCache && Date.now() - botIPCache.fetchedAt < BOTIP_MEMORY_TTL_MS) {
    return botIPCache.ranges;
  }
  try {
    if (env.WEBMCP_CACHE) {
      const cached = await env.WEBMCP_CACHE.get(BOTIP_CACHE_KEY);
      if (cached) {
        const ranges2 = JSON.parse(cached).map(parseCidr).filter((r) => r !== null);
        if (ranges2.length > 0) {
          botIPCache = { ranges: ranges2, fetchedAt: Date.now() };
          return ranges2;
        }
      }
    }
    const cidrs = [];
    for (const url of BOT_IP_RANGE_URLS) {
      try {
        const resp = await fetch(url, { headers: { Accept: "application/json" } });
        if (!resp.ok) {
          continue;
        }
        const body = await resp.json();
        for (const p of body.prefixes ?? []) {
          const c = p.ipv4Prefix || p.ipv6Prefix;
          if (c) {
            cidrs.push(c);
          }
        }
      } catch (err) {
        console.error("trustdata bot IP range fetch failed:", url, err);
      }
    }
    const ranges = cidrs.map(parseCidr).filter((r) => r !== null);
    if (env.WEBMCP_CACHE && cidrs.length > 0) {
      await env.WEBMCP_CACHE.put(BOTIP_CACHE_KEY, JSON.stringify(cidrs), {
        expirationTtl: BOTIP_KV_TTL_SECONDS
      });
    }
    botIPCache = { ranges, fetchedAt: Date.now() };
    return ranges;
  } catch (err) {
    console.error("trustdata bot IP range sync failed:", err);
    botIPCache = { ranges: [], fetchedAt: Date.now() };
    return [];
  }
}
__name(getBotIPRanges, "getBotIPRanges");
var BOTKEYS_CACHE_PREFIX = "aibotkeys:v1:";
function parseSignatureInput(raw) {
  const s = raw.trim();
  const eq = s.indexOf("=");
  if (eq <= 0) {
    return null;
  }
  const label = s.slice(0, eq).trim();
  const rawParams = s.slice(eq + 1).trim();
  if (!rawParams.startsWith("(")) {
    return null;
  }
  const close = rawParams.indexOf(")");
  if (close < 0) {
    return null;
  }
  const covered = rawParams.slice(1, close).split(/\s+/).map((t) => t.replace(/^"|"$/g, "")).filter(Boolean);
  if (covered.length === 0) {
    return null;
  }
  return {
    label,
    covered,
    rawParams,
    keyid: sfQuotedParam(rawParams, "keyid"),
    alg: sfQuotedParam(rawParams, "alg")
  };
}
__name(parseSignatureInput, "parseSignatureInput");
function sfQuotedParam(raw, name) {
  const m = raw.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : "";
}
__name(sfQuotedParam, "sfQuotedParam");
function sfIntParam(raw, name) {
  const m = raw.match(new RegExp(`${name}=(\\d+)`));
  return m ? Number(m[1]) : null;
}
__name(sfIntParam, "sfIntParam");
function parseSignature(raw, label) {
  for (const part of raw.split(",")) {
    const p = part.trim();
    const eq = p.indexOf("=");
    if (eq <= 0 || p.slice(0, eq).trim() !== label) {
      continue;
    }
    const val = p.slice(eq + 1).trim();
    if (val.length < 2 || val[0] !== ":" || val[val.length - 1] !== ":") {
      return null;
    }
    try {
      return base64ToBytes(val.slice(1, -1));
    } catch {
      return null;
    }
  }
  return null;
}
__name(parseSignature, "parseSignature");
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
__name(base64ToBytes, "base64ToBytes");
function bytesToBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function buildSignatureBase(req, covered, rawParams) {
  const lines = [];
  for (const c of covered) {
    let value;
    switch (c) {
      case "@method":
        value = req.method;
        break;
      case "@authority":
        value = req.authority;
        break;
      case "@path":
        value = req.path;
        break;
      default:
        if (c.startsWith("@")) {
          return null;
        }
        value = req.headers.get(c);
        break;
    }
    if (value === null || value === void 0) {
      return null;
    }
    lines.push(`"${c}": ${value}`);
  }
  lines.push(`"@signature-params": ${rawParams}`);
  return lines.join("\n");
}
__name(buildSignatureBase, "buildSignatureBase");
async function jwkThumbprint(jwk) {
  const json = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return bytesToBase64Url(new Uint8Array(digest));
}
__name(jwkThumbprint, "jwkThumbprint");
async function fetchKeyDirectory(url, env) {
  const cacheKey = `${BOTKEYS_CACHE_PREFIX}${url}`;
  try {
    if (env.WEBMCP_CACHE) {
      const cached = await env.WEBMCP_CACHE.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) {
      return [];
    }
    const body = await resp.json();
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (env.WEBMCP_CACHE && keys.length > 0) {
      await env.WEBMCP_CACHE.put(cacheKey, JSON.stringify(keys), {
        expirationTtl: BOTIP_KV_TTL_SECONDS
      });
    }
    return keys;
  } catch (err) {
    console.error("trustdata key directory fetch failed:", url, err);
    return [];
  }
}
__name(fetchKeyDirectory, "fetchKeyDirectory");
async function verifySignature(request, env) {
  const sigHeader = request.headers.get("signature");
  const sigInputHeader = request.headers.get("signature-input");
  if (!sigHeader || !sigInputHeader) {
    return "unknown";
  }
  const parsed = parseSignatureInput(sigInputHeader);
  if (!parsed || !parsed.keyid || parsed.alg && parsed.alg !== "ed25519") {
    return "unknown";
  }
  const expires = sfIntParam(parsed.rawParams, "expires");
  if (expires !== null && expires * 1e3 < Date.now()) {
    return "unverified";
  }
  const sig = parseSignature(sigHeader, parsed.label);
  if (!sig) {
    return "unknown";
  }
  const agent = request.headers.get("signature-agent");
  if (!agent) {
    return "unknown";
  }
  let directoryUrl;
  try {
    directoryUrl = new URL(agent.trim().replace(/^"|"$/g, "")).toString();
  } catch {
    return "unknown";
  }
  const keys = await fetchKeyDirectory(directoryUrl, env);
  let jwk;
  for (const k of keys) {
    if (k.kty !== "OKP" || k.crv !== "Ed25519" || typeof k.x !== "string") {
      continue;
    }
    const tp = await jwkThumbprint({ kty: k.kty, crv: k.crv, x: k.x });
    if (tp === parsed.keyid || k.kid === parsed.keyid) {
      jwk = k;
      break;
    }
  }
  if (!jwk) {
    return "unknown";
  }
  const url = new URL(request.url);
  const base = buildSignatureBase(
    {
      method: request.method,
      authority: url.host,
      path: url.pathname,
      headers: request.headers
    },
    parsed.covered,
    parsed.rawParams
  );
  if (base === null) {
    return "unknown";
  }
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, [
      "verify"
    ]);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sig,
      new TextEncoder().encode(base)
    );
    return ok ? "verified" : "unverified";
  } catch (err) {
    console.error("trustdata signature verify failed:", err);
    return "unknown";
  }
}
__name(verifySignature, "verifySignature");
var WEBMCP_CACHE_TTL_SECONDS = 3600;
var WEBMCP_CACHE_KEY_PREFIX = "webmcp:v1:";
var WEBMCP_PATH = "/.well-known/webmcp.json";
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === WEBMCP_PATH) {
      return serveWebmcpManifest(request, env, ctx);
    }
    const response = await fetch(request);
    const responseClone = response.clone();
    ctx.waitUntil(forwardLog(request, responseClone, env));
    return response;
  }
};
async function forwardLog(request, response, env) {
  if (!env.TRUSTDATA_INGEST_URL || !env.TRUSTDATA_API_KEY) {
    return;
  }
  const userAgent = request.headers.get("user-agent");
  const referer = request.headers.get("referer");
  const lists = await getBotLists(env);
  const match = classifyRequest(userAgent, referer, lists);
  const forwardAll = env.TRUSTDATA_FORWARD_ALL === "true";
  let sampleRate;
  if (!match && !forwardAll) {
    sampleRate = parseSampleRate(env.TRUSTDATA_SAMPLE_RATE);
    if (sampleRate <= 0 || Math.random() >= sampleRate) {
      return;
    }
  }
  const url = new URL(request.url);
  const responseBody = await response.blob();
  const headerSize = Array.from(response.headers.entries()).reduce(
    (total, [key, value]) => total + key.length + value.length + 4,
    // ": " + "\r\n"
    0
  );
  const log = {
    timestamp: Date.now(),
    attribution_id: env.TRUSTDATA_ATTRIBUTION_ID ?? "",
    host: url.hostname,
    method: request.method,
    pathname: url.pathname,
    query_params: Object.fromEntries(url.searchParams),
    ip: request.headers.get("cf-connecting-ip"),
    user_agent: userAgent,
    referer,
    bytes: headerSize + responseBody.size,
    status: response.status,
    country: request.cf?.country,
    asn: request.cf?.asn
  };
  if (sampleRate !== void 0) {
    log.ip = anonymizeIp(log.ip);
    log.query_params = {};
    log.referer = refererHost(referer);
    log.sample_rate = sampleRate;
  } else if (match === "bot") {
    const sigResult = await verifySignature(request, env);
    if (sigResult !== "unknown") {
      log.verified = sigResult === "verified";
      log.verified_by = "signature";
    } else if (isVerifiableBotUA(userAgent)) {
      const ranges = await getBotIPRanges(env);
      if (ranges.length > 0) {
        log.verified = ipInRanges(log.ip, ranges);
        log.verified_by = "edge_cidr";
      }
    }
    log.ip = null;
  } else if (match === "referral") {
    log.ip = null;
  }
  try {
    await fetch(env.TRUSTDATA_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.TRUSTDATA_API_KEY
      },
      body: JSON.stringify([log])
    });
  } catch (err) {
    console.error("trustdata log forward failed:", err);
  }
}
__name(forwardLog, "forwardLog");
async function serveWebmcpManifest(request, env, ctx) {
  if (!env.TRUSTDATA_MANIFEST_URL || !env.TRUSTDATA_ATTRIBUTION_ID) {
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
          "X-TrustData-Cache": "hit"
        }
      });
    }
  }
  const upstreamUrl = buildManifestUrl(
    env.TRUSTDATA_MANIFEST_URL,
    env.TRUSTDATA_ATTRIBUTION_ID
  );
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
  } catch (err) {
    console.error("trustdata webmcp fetch failed:", err);
    return new Response(
      JSON.stringify({ error: "Manifest upstream unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
  if (upstream.status === 404) {
    return new Response(JSON.stringify({ error: "No manifest configured" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: "Manifest upstream error" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
  const body = await upstream.text();
  if (env.WEBMCP_CACHE) {
    ctx.waitUntil(
      env.WEBMCP_CACHE.put(cacheKey, body, {
        expirationTtl: WEBMCP_CACHE_TTL_SECONDS
      })
    );
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${WEBMCP_CACHE_TTL_SECONDS}`,
      "X-TrustData-Cache": "miss"
    }
  });
}
__name(serveWebmcpManifest, "serveWebmcpManifest");
function buildManifestUrl(template, attributionId) {
  if (template.includes("<attribution_id>")) {
    return template.replace("<attribution_id>", attributionId);
  }
  if (template.includes("{attribution_id}")) {
    return template.replace("{attribution_id}", attributionId);
  }
  const trimmed = template.replace(/\/+$/, "");
  return `${trimmed}/${attributionId}/manifest/`;
}
__name(buildManifestUrl, "buildManifestUrl");
export {
  AI_BOT_USER_AGENTS,
  AI_REFERRER_DOMAINS,
  BOTIP_CACHE_KEY,
  BOTIP_KV_TTL_SECONDS,
  BOTIP_MEMORY_TTL_MS,
  BOTKEYS_CACHE_PREFIX,
  BOTLIST_CACHE_KEY,
  BOTLIST_KV_TTL_SECONDS,
  BOTLIST_MEMORY_TTL_MS,
  BOT_IP_RANGE_URLS,
  DEFAULT_SAMPLE_RATE,
  EMBEDDED_BOT_LISTS,
  VERIFIABLE_BOT_UAS,
  WEBMCP_CACHE_KEY_PREFIX,
  WEBMCP_CACHE_TTL_SECONDS,
  WEBMCP_PATH,
  _resetBotIPCache,
  _resetBotListCache,
  anonymizeIp,
  buildManifestUrl,
  buildSignatureBase,
  classifyRequest,
  index_default as default,
  forwardLog,
  getBotIPRanges,
  getBotLists,
  ipInRanges,
  ipToBigInt,
  isVerifiableBotUA,
  jwkThumbprint,
  parseCidr,
  parseSampleRate,
  parseSignature,
  parseSignatureInput,
  refererHost,
  serveWebmcpManifest,
  verifySignature
};
