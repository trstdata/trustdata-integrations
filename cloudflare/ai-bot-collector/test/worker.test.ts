/**
 * Unit tests for forwardLog — the payload-building half of the Worker.
 *
 * The fetch handler itself is trivially a pass-through wrapper around fetch(),
 * so we test what actually matters: payload shape, header auth, no-config
 * early-return.
 */

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import {
  forwardLog,
  classifyRequest,
  getBotLists,
  anonymizeIp,
  refererHost,
  parseSampleRate,
  serveWebmcpManifest,
  buildManifestUrl,
  DEFAULT_SAMPLE_RATE,
  BOTLIST_CACHE_KEY,
  BOTLIST_KV_TTL_SECONDS,
  EMBEDDED_BOT_LISTS,
  WEBMCP_CACHE_TTL_SECONDS,
  WEBMCP_PATH,
  _resetBotListCache,
  ipToBigInt,
  parseCidr,
  ipInRanges,
  getBotIPRanges,
  _resetBotIPCache,
  verifySignature,
  buildSignatureBase,
  parseSignatureInput,
  jwkThumbprint,
  type CidrRange,
  type Env,
} from "../src/index";

describe("forwardLog", () => {
  const baseEnv: Env = {
    TRUSTDATA_INGEST_URL: "https://ingest.test/v1/logs/cloudflare_worker",
    TRUSTDATA_API_KEY: "secret",
    TRUSTDATA_ATTRIBUTION_ID: "prop-1",
  };

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  function buildRequest(
    url: string,
    headers: Record<string, string> = {},
  ): Request {
    return new Request(url, { method: "GET", headers });
  }

  function buildResponse(): Response {
    return new Response("<html>hi</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }

  it("sends a batched JSON array with X-API-Key", async () => {
    const req = buildRequest("https://example.com/blog/post?utm_source=chatgpt", {
      "user-agent": "Mozilla/5.0",
      "cf-connecting-ip": "1.2.3.4",
      referer: "https://chat.openai.com/",
    });

    await forwardLog(req, buildResponse(), baseEnv);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [sentUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(sentUrl).toBe(baseEnv.TRUSTDATA_INGEST_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("secret");

    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    const log = body[0];
    expect(log.attribution_id).toBe("prop-1");
    expect(log.host).toBe("example.com");
    expect(log.pathname).toBe("/blog/post");
    expect(log.query_params).toEqual({ utm_source: "chatgpt" });
    expect(log.user_agent).toBe("Mozilla/5.0");
    expect(log.referer).toBe("https://chat.openai.com/");
    expect(log.ip).toBeNull(); // AI referral — IP not forwarded
    expect(log.status).toBe(200);
    expect(typeof log.timestamp).toBe("number");
  });

  it("is a no-op when ingest URL or API key is missing", async () => {
    const req = buildRequest("https://example.com/");

    await forwardLog(req, buildResponse(), {
      ...baseEnv,
      TRUSTDATA_API_KEY: "",
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await forwardLog(req, buildResponse(), {
      ...baseEnv,
      TRUSTDATA_INGEST_URL: "",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("swallows ingest failures so the customer response is unaffected", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    // Bot UA so the entry is deterministically forwarded (no sampling roll).
    const req = buildRequest("https://example.com/", { "user-agent": "GPTBot/1.0" });

    // Should not throw.
    await expect(forwardLog(req, buildResponse(), baseEnv)).resolves.toBeUndefined();
  });

  describe("edge filtering & sampling", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      _resetBotIPCache();
    });

    it("forwards AI-bot requests but verifies and drops the IP at the edge", async () => {
      const req = buildRequest("https://example.com/robots.txt?ref=abc", {
        "user-agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0)",
        "cf-connecting-ip": "1.2.3.4",
      });

      await forwardLog(req, buildResponse(), baseEnv);

      // The bot branch also fetches vendor IP ranges; find the ingest POST.
      const ingest = fetchSpy.mock.calls.find(
        (c) => (c[1] as RequestInit)?.body !== undefined,
      );
      expect(ingest).toBeDefined();
      const log = JSON.parse((ingest![1] as RequestInit).body as string)[0];
      expect(log.ip).toBeNull(); // verified at the edge — raw IP never leaves the zone
      expect(log.query_params).toEqual({ ref: "abc" });
      expect(log.sample_rate).toBeUndefined();
    });

    it("drops non-AI traffic when the sample roll misses", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const req = buildRequest("https://example.com/pricing", {
        "user-agent": "Mozilla/5.0",
        "cf-connecting-ip": "1.2.3.4",
      });

      await forwardLog(req, buildResponse(), baseEnv);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("forwards a sampled non-AI request anonymized and weighted", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0.001);
      const req = buildRequest(
        "https://example.com/account?token=s3cret&email=a@b.c",
        {
          "user-agent": "Mozilla/5.0",
          "cf-connecting-ip": "203.0.113.77",
          referer: "https://news.ycombinator.com/item?id=1",
        },
      );

      await forwardLog(req, buildResponse(), baseEnv);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const log = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
      )[0];
      expect(log.sample_rate).toBe(DEFAULT_SAMPLE_RATE);
      expect(log.ip).toBe("203.0.113.0");
      expect(log.query_params).toEqual({});
      expect(log.referer).toBe("news.ycombinator.com");
      expect(log.user_agent).toBe("Mozilla/5.0"); // kept — needed for bot discovery
      expect(log.pathname).toBe("/account");
    });

    it("honors TRUSTDATA_SAMPLE_RATE=0 (no sampling at all)", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0.0);
      const req = buildRequest("https://example.com/", { "user-agent": "Mozilla/5.0" });

      await forwardLog(req, buildResponse(), {
        ...baseEnv,
        TRUSTDATA_SAMPLE_RATE: "0",
      });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("forwards everything unfiltered when TRUSTDATA_FORWARD_ALL=true", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const req = buildRequest("https://example.com/page?q=1", {
        "user-agent": "Mozilla/5.0",
        "cf-connecting-ip": "1.2.3.4",
      });

      await forwardLog(req, buildResponse(), {
        ...baseEnv,
        TRUSTDATA_FORWARD_ALL: "true",
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const log = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
      )[0];
      expect(log.ip).toBe("1.2.3.4");
      expect(log.query_params).toEqual({ q: "1" });
      expect(log.sample_rate).toBeUndefined();
    });
  });
});

describe("classifyRequest", () => {
  it("matches known AI bot user agents as substrings", () => {
    expect(classifyRequest("Mozilla/5.0 (compatible; GPTBot/1.2)", null)).toBe("bot");
    expect(classifyRequest("PerplexityBot/1.0", null)).toBe("bot");
    expect(classifyRequest("Bytespider; spider-feedback@bytedance.com", null)).toBe("bot");
  });

  it("matches user-triggered fetchers (AI Visits)", () => {
    expect(classifyRequest("Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0", null)).toBe("bot");
    expect(classifyRequest("Mozilla/5.0 (compatible; Claude-User/1.0)", null)).toBe("bot");
    expect(classifyRequest("Mozilla/5.0 (compatible; Perplexity-User/1.0)", null)).toBe("bot");
    expect(classifyRequest("MistralAI-User/1.0", null)).toBe("bot");
  });

  it("matches case-insensitively (Meta ships lowercase UAs)", () => {
    expect(classifyRequest("meta-externalagent/1.1 (+https://developers.facebook.com/...)", null)).toBe("bot");
    expect(classifyRequest("meta-externalfetcher/1.1", null)).toBe("bot");
    expect(classifyRequest("MOZILLA/5.0 (COMPATIBLE; GPTBOT/1.0)", null)).toBe("bot");
  });

  it("matches AI-engine referrers, stripping www. and subdomains", () => {
    expect(classifyRequest("Mozilla/5.0", "https://chat.openai.com/")).toBe("referral");
    expect(classifyRequest("Mozilla/5.0", "https://www.perplexity.ai/search?q=x")).toBe("referral");
    expect(classifyRequest("Mozilla/5.0", "https://fr.claude.ai/chat/123")).toBe("referral");
  });

  it("prefers bot over referral when both match", () => {
    expect(classifyRequest("GPTBot/1.0", "https://chatgpt.com/")).toBe("bot");
  });

  it("returns null for regular browsers and non-AI referrers", () => {
    expect(classifyRequest("Mozilla/5.0 (Macintosh)", "https://google.com/")).toBeNull();
    expect(classifyRequest("Mozilla/5.0 (Macintosh)", null)).toBeNull();
    expect(classifyRequest(null, null)).toBeNull();
  });

  it("does not over-match lookalike domains", () => {
    // "notclaude.ai" must not match "claude.ai" — label-boundary stripping only.
    expect(classifyRequest("Mozilla/5.0", "https://notclaude.ai/")).toBeNull();
  });
});

describe("anonymizeIp", () => {
  it("zeroes the last IPv4 octet (/24)", () => {
    expect(anonymizeIp("203.0.113.77")).toBe("203.0.113.0");
  });

  it("keeps the first three IPv6 groups (/48)", () => {
    expect(anonymizeIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::");
  });

  it("returns null for null or malformed input", () => {
    expect(anonymizeIp(null)).toBeNull();
    expect(anonymizeIp("not-an-ip")).toBeNull();
  });
});

describe("refererHost", () => {
  it("extracts the lowercased hostname from a URL", () => {
    expect(refererHost("https://News.Ycombinator.com/item?id=1")).toBe("news.ycombinator.com");
  });

  it("handles bare hosts and null", () => {
    expect(refererHost("example.com/path")).toBe("example.com");
    expect(refererHost(null)).toBeNull();
    expect(refererHost("")).toBeNull();
  });
});

describe("parseSampleRate", () => {
  it("defaults when unset, empty, or invalid", () => {
    expect(parseSampleRate(undefined)).toBe(DEFAULT_SAMPLE_RATE);
    expect(parseSampleRate("")).toBe(DEFAULT_SAMPLE_RATE);
    expect(parseSampleRate("abc")).toBe(DEFAULT_SAMPLE_RATE);
    expect(parseSampleRate("-1")).toBe(DEFAULT_SAMPLE_RATE);
  });

  it("parses explicit values and clamps to 1", () => {
    expect(parseSampleRate("0")).toBe(0);
    expect(parseSampleRate("0.05")).toBe(0.05);
    expect(parseSampleRate("5")).toBe(1);
  });
});

describe("getBotLists (runtime sync)", () => {
  const configBody = JSON.stringify({
    version: 1,
    bot_patterns: [
      { pattern: "gptbot", bot_name: "GPTBot", intent: "training", engine: "openai" },
      { pattern: "newbot9000", bot_name: "NewBot9000", intent: "on_demand", engine: "unknown" },
    ],
    ai_referrer_domains: ["chatgpt.com", "newengine.ai"],
  });

  const syncEnv: Env = {
    TRUSTDATA_INGEST_URL: "https://ingest.test/v1/logs/cloudflare_worker",
    TRUSTDATA_API_KEY: "secret",
    TRUSTDATA_ATTRIBUTION_ID: "prop-1",
    TRUSTDATA_BOTLIST_URL: "https://t.test/v1/config/ai-bots",
  };

  let fetchSpy: ReturnType<typeof vi.fn>;

  function buildKV(store = new Map<string, string>()) {
    const kv = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    };
    return { kv: kv as unknown as KVNamespace, store, spies: kv };
  }

  beforeEach(() => {
    _resetBotListCache();
    _resetBotIPCache();
    fetchSpy = vi.fn().mockResolvedValue(new Response(configBody, { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  it("returns the embedded lists when no botlist URL is configured", async () => {
    const lists = await getBotLists({ ...syncEnv, TRUSTDATA_BOTLIST_URL: "" });
    expect(lists).toBe(EMBEDDED_BOT_LISTS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the canonical list, uses it, and stores it in KV", async () => {
    const { kv, spies } = buildKV();
    const lists = await getBotLists({ ...syncEnv, WEBMCP_CACHE: kv });

    expect(lists.patterns).toContain("newbot9000");
    expect(classifyRequest("NewBot9000/1.0", null, lists)).toBe("bot");
    expect(classifyRequest("Mozilla/5.0", "https://newengine.ai/x", lists)).toBe("referral");
    expect(spies.put).toHaveBeenCalledWith(BOTLIST_CACHE_KEY, configBody, {
      expirationTtl: BOTLIST_KV_TTL_SECONDS,
    });
  });

  it("serves from KV without hitting the upstream", async () => {
    const { kv } = buildKV(new Map([[BOTLIST_CACHE_KEY, configBody]]));
    const lists = await getBotLists({ ...syncEnv, WEBMCP_CACHE: kv });

    expect(lists.patterns).toContain("newbot9000");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("memoizes per isolate (one fetch for many requests)", async () => {
    await getBotLists(syncEnv);
    await getBotLists(syncEnv);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("falls back to the embedded lists when the upstream fails", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    const lists = await getBotLists(syncEnv);

    expect(lists).toBe(EMBEDDED_BOT_LISTS);
    expect(classifyRequest("GPTBot/1.0", null, lists)).toBe("bot");
    // Failure is memoized too — no hammering a broken upstream.
    await getBotLists(syncEnv);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("falls back when the upstream returns an invalid shape", async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"bot_patterns": []}', { status: 200 }));
    const lists = await getBotLists(syncEnv);
    expect(lists).toBe(EMBEDDED_BOT_LISTS);
  });

  it("forwards a bot only present in the synced list (end-to-end)", async () => {
    const req = new Request("https://example.com/page", {
      method: "GET",
      headers: { "user-agent": "NewBot9000/1.0" },
    });
    const resp = new Response("ok", { status: 200 });

    await forwardLog(req, resp, syncEnv);

    // The bot branch also fetches vendor IP ranges, so locate the ingest POST
    // by URL rather than by call index.
    const ingest = fetchSpy.mock.calls.find(
      (c) => c[0] === syncEnv.TRUSTDATA_INGEST_URL,
    );
    expect(ingest).toBeDefined();
    const log = JSON.parse((ingest![1] as RequestInit).body as string)[0];
    expect(log.user_agent).toBe("NewBot9000/1.0");
    expect(log.sample_rate).toBeUndefined();
  });
});

// ── WebMCP manifest ────────────────────────────────────────────────────────
describe("buildManifestUrl", () => {
  it("substitutes <attribution_id> placeholder", () => {
    expect(
      buildManifestUrl(
        "https://app.trustdata.tech/api/v1/webmcp/<attribution_id>/manifest/",
        "prop-abc",
      ),
    ).toBe("https://app.trustdata.tech/api/v1/webmcp/prop-abc/manifest/");
  });

  it("substitutes {attribution_id} placeholder", () => {
    expect(
      buildManifestUrl(
        "https://app.trustdata.tech/api/v1/webmcp/{attribution_id}/manifest/",
        "prop-abc",
      ),
    ).toBe("https://app.trustdata.tech/api/v1/webmcp/prop-abc/manifest/");
  });

  it("appends attribution_id + /manifest/ when no placeholder given", () => {
    expect(
      buildManifestUrl("https://app.trustdata.tech/api/v1/webmcp", "prop-abc"),
    ).toBe("https://app.trustdata.tech/api/v1/webmcp/prop-abc/manifest/");
  });

  it("handles trailing slashes on the base", () => {
    expect(
      buildManifestUrl("https://app.trustdata.tech/api/v1/webmcp///", "prop-abc"),
    ).toBe("https://app.trustdata.tech/api/v1/webmcp/prop-abc/manifest/");
  });
});

describe("serveWebmcpManifest", () => {
  const signedManifestBody = JSON.stringify({
    version: 1,
    tools: [{ name: "search", description: "Search" }],
    public_key: "pk",
    signature: "sig",
    issued_at: "2026-04-21T00:00:00Z",
  });

  const baseEnv: Env = {
    TRUSTDATA_INGEST_URL: "",
    TRUSTDATA_API_KEY: "",
    TRUSTDATA_ATTRIBUTION_ID: "prop-1",
    TRUSTDATA_MANIFEST_URL: "https://app.trustdata.tech/api/v1/webmcp",
  };

  // Vitest ctx stub — all we need is waitUntil to be callable.
  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(signedManifestBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  function buildKV(): KVNamespace {
    const store = new Map<string, string>();
    return {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;
  }

  it("fetches upstream and caches the body on cache miss", async () => {
    const WEBMCP_CACHE = buildKV();
    const env: Env = { ...baseEnv, WEBMCP_CACHE };

    const req = new Request(`https://example.com${WEBMCP_PATH}`, { method: "GET" });
    const resp = await serveWebmcpManifest(req, env, ctx);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/json");
    expect(resp.headers.get("X-TrustData-Cache")).toBe("miss");
    expect(resp.headers.get("Cache-Control")).toBe(
      `public, max-age=${WEBMCP_CACHE_TTL_SECONDS}`,
    );
    expect(await resp.text()).toBe(signedManifestBody);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://app.trustdata.tech/api/v1/webmcp/prop-1/manifest/");
    expect(WEBMCP_CACHE.put).toHaveBeenCalledWith(
      "webmcp:v1:prop-1",
      signedManifestBody,
      { expirationTtl: WEBMCP_CACHE_TTL_SECONDS },
    );
  });

  it("returns the cached body without calling upstream on cache hit", async () => {
    const WEBMCP_CACHE = buildKV();
    // Warm the cache directly.
    await WEBMCP_CACHE.put("webmcp:v1:prop-1", signedManifestBody);
    const env: Env = { ...baseEnv, WEBMCP_CACHE };

    const req = new Request(`https://example.com${WEBMCP_PATH}`, { method: "GET" });
    const resp = await serveWebmcpManifest(req, env, ctx);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-TrustData-Cache")).toBe("hit");
    expect(await resp.text()).toBe(signedManifestBody);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates upstream 404 as a 404", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const env: Env = { ...baseEnv, WEBMCP_CACHE: buildKV() };

    const req = new Request(`https://example.com${WEBMCP_PATH}`, { method: "GET" });
    const resp = await serveWebmcpManifest(req, env, ctx);

    expect(resp.status).toBe(404);
  });

  it("returns 502 on upstream 5xx", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const env: Env = { ...baseEnv, WEBMCP_CACHE: buildKV() };

    const req = new Request(`https://example.com${WEBMCP_PATH}`, { method: "GET" });
    const resp = await serveWebmcpManifest(req, env, ctx);

    expect(resp.status).toBe(502);
  });

  it("returns 502 on upstream network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    const env: Env = { ...baseEnv, WEBMCP_CACHE: buildKV() };

    const req = new Request(`https://example.com${WEBMCP_PATH}`, { method: "GET" });
    const resp = await serveWebmcpManifest(req, env, ctx);

    expect(resp.status).toBe(502);
  });

  it("falls through to origin when TRUSTDATA_MANIFEST_URL is unset", async () => {
    const env: Env = {
      ...baseEnv,
      TRUSTDATA_MANIFEST_URL: "",
    };
    const req = new Request(`https://example.com${WEBMCP_PATH}`, { method: "GET" });

    fetchSpy.mockResolvedValueOnce(new Response("origin body", { status: 200 }));
    const resp = await serveWebmcpManifest(req, env, ctx);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledWith] = fetchSpy.mock.calls[0] as [Request];
    expect((calledWith as Request).url).toBe(`https://example.com${WEBMCP_PATH}`);
    expect(resp.status).toBe(200);
  });

  it("works without a KV binding (no caching, still serves)", async () => {
    const env: Env = { ...baseEnv }; // no WEBMCP_CACHE
    const req = new Request(`https://example.com${WEBMCP_PATH}`, { method: "GET" });

    const resp = await serveWebmcpManifest(req, env, ctx);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-TrustData-Cache")).toBe("miss");
    expect(await resp.text()).toBe(signedManifestBody);
  });
});

describe("edge IP verification", () => {
  afterEach(() => {
    _resetBotIPCache();
    vi.unstubAllGlobals();
  });

  it("parses IPv4 and IPv6 to integers, rejecting junk", () => {
    expect(ipToBigInt("203.0.113.7")?.v6).toBe(false);
    expect(ipToBigInt("2001:db8::1")?.v6).toBe(true);
    expect(ipToBigInt("203.0.113")).toBeNull();
    expect(ipToBigInt("999.0.0.1")).toBeNull();
    expect(ipToBigInt("not-an-ip")).toBeNull();
    expect(ipToBigInt("2001::db8::1")).toBeNull(); // two "::"
  });

  it("matches IPv4 and IPv6 CIDR ranges", () => {
    const ranges = [parseCidr("203.0.113.0/24"), parseCidr("2001:db8::/32")].filter(
      (r): r is CidrRange => r !== null,
    );
    expect(ipInRanges("203.0.113.50", ranges)).toBe(true);
    expect(ipInRanges("2001:db8::dead", ranges)).toBe(true);
    expect(ipInRanges("198.51.100.4", ranges)).toBe(false);
    expect(ipInRanges("2001:dead::1", ranges)).toBe(false);
    expect(ipInRanges(null, ranges)).toBe(false);
  });

  it("rejects malformed CIDRs", () => {
    expect(parseCidr("203.0.113.0")).toBeNull(); // no /bits
    expect(parseCidr("203.0.113.0/33")).toBeNull(); // out of range
    expect(parseCidr("garbage/24")).toBeNull();
  });

  it("getBotIPRanges fetches and parses vendor prefix lists", async () => {
    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ prefixes: [{ ipv4Prefix: "203.0.113.0/24" }, { ipv6Prefix: "2001:db8::/32" }] }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const ranges = await getBotIPRanges({} as Env);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ipInRanges("203.0.113.9", ranges)).toBe(true);
  });
});

describe("web bot auth signature verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Build a signed request + a key directory that serves the matching JWK.
  async function buildSigned(opts: { path?: string; tamperPath?: string } = {}) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pubJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey & {
      kty: string;
      crv: string;
      x: string;
    };
    const keyid = await jwkThumbprint({ kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x });

    const path = opts.path ?? "/robots.txt";
    const rawParams = `("@authority" "@path");created=1700000000;keyid="${keyid}";alg="ed25519"`;
    const base = buildSignatureBase(
      { method: "GET", authority: "example.com", path, headers: new Headers() },
      ["@authority", "@path"],
      rawParams,
    )!;
    // Pin the serialization to the RFC 9421 shape.
    expect(base).toBe(
      `"@authority": example.com\n"@path": ${path}\n"@signature-params": ${rawParams}`,
    );

    const sigBytes = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(base)),
    );
    let bin = "";
    for (const b of sigBytes) bin += String.fromCharCode(b);
    const sigB64 = btoa(bin);

    const req = new Request(`https://example.com${opts.tamperPath ?? path}`, {
      method: "GET",
      headers: {
        signature: `sig1=:${sigB64}:`,
        "signature-input": `sig1=${rawParams}`,
        "signature-agent": '"https://dir.test/keys"',
      },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    return req;
  }

  it("verifies a valid Ed25519 signature against the key directory", async () => {
    const req = await buildSigned();
    expect(await verifySignature(req, {} as Env)).toBe("verified");
  });

  it("rejects a signature when the request path was tampered", async () => {
    // Sign over /robots.txt but send /admin → base mismatch → bad signature.
    const req = await buildSigned({ path: "/robots.txt", tamperPath: "/admin" });
    expect(await verifySignature(req, {} as Env)).toBe("unverified");
  });

  it("returns unknown when there is no signature", async () => {
    const req = new Request("https://example.com/robots.txt", { method: "GET" });
    expect(await verifySignature(req, {} as Env)).toBe("unknown");
  });

  it("returns unknown when the key directory has no matching key", async () => {
    const req = await buildSigned();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [] }), { status: 200 })),
    );
    expect(await verifySignature(req, {} as Env)).toBe("unknown");
  });

  it("parses a Signature-Input header", () => {
    const parsed = parseSignatureInput('sig1=("@authority" "@path");keyid="abc";alg="ed25519"');
    expect(parsed?.covered).toEqual(["@authority", "@path"]);
    expect(parsed?.keyid).toBe("abc");
    expect(parsed?.alg).toBe("ed25519");
  });
});
