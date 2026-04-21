/**
 * Unit tests for forwardLog — the payload-building half of the Worker.
 *
 * The fetch handler itself is trivially a pass-through wrapper around fetch(),
 * so we test what actually matters: payload shape, header auth, no-config
 * early-return.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  forwardLog,
  serveWebmcpManifest,
  buildManifestUrl,
  WEBMCP_CACHE_TTL_SECONDS,
  WEBMCP_PATH,
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
    expect(log.ip).toBe("1.2.3.4");
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
    const req = buildRequest("https://example.com/");

    // Should not throw.
    await expect(forwardLog(req, buildResponse(), baseEnv)).resolves.toBeUndefined();
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
