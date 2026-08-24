/**
 * SSRF guard coverage for /v1/search's shared base-url resolution (GHSA-j7j4-g9qc-q69c).
 *
 * `provider_options.baseUrl` is client-controlled and flows through
 * `resolveSearchBaseUrl()` into every search builder's server-side fetch target
 * (searxng, ollama, …). Persisted `providerSpecificData.baseUrl`, by contrast,
 * is operator configuration and must keep supporting self-hosted LAN instances.
 *
 * The request override therefore uses `public-only`, with DNS pinning at the
 * fetch seam. Persisted configuration uses `block-metadata`: private hosts keep
 * working while cloud-metadata endpoints remain unconditionally forbidden.
 *
 * Run with:
 *   node --import tsx/esm --test tests/unit/search-baseurl-ssrf-guard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSearchBaseUrl } from "../../open-sse/handlers/search.ts";
import type { SearchProviderConfig } from "../../open-sse/config/searchRegistry.ts";
import { fetchClientControlledSearchUrl } from "../../open-sse/handlers/search/searchProxy.ts";

const config: SearchProviderConfig = {
  id: "searxng-search",
  name: "SearXNG",
  baseUrl: "http://127.0.0.1:8888",
  method: "GET",
  authType: "none",
  costPerQuery: 0,
} as SearchProviderConfig;

const base = {
  query: "test",
  searchType: "web",
  maxResults: 5,
};

const METADATA_URLS = [
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  "http://169.254.169.254/latest/meta-data/?x=/search", // reporter's suffix-bypass shape
  "http://metadata.google.internal/computeMetadata/v1/",
];

describe("resolveSearchBaseUrl — SSRF guard on client-controlled baseUrl (GHSA-j7j4)", () => {
  for (const malicious of METADATA_URLS) {
    it(`rejects providerOptions.baseUrl pointing at cloud metadata (${malicious})`, () => {
      assert.throws(() => {
        resolveSearchBaseUrl(config, { ...base, providerOptions: { baseUrl: malicious } });
      });
    });

    it(`rejects providerSpecificData.baseUrl pointing at cloud metadata (${malicious})`, () => {
      assert.throws(() => {
        resolveSearchBaseUrl(config, { ...base, providerSpecificData: { baseUrl: malicious } });
      });
    });
  }

  it("rejects client overrides targeting loopback or LAN addresses", () => {
    assert.throws(() =>
      resolveSearchBaseUrl(config, {
        ...base,
        providerOptions: { baseUrl: "http://127.0.0.1:9999" },
      })
    );
    assert.throws(() =>
      resolveSearchBaseUrl(config, {
        ...base,
        providerOptions: { baseUrl: "http://10.0.0.5:8080" },
      })
    );
  });

  it("still allows loopback and LAN addresses from persisted provider configuration", () => {
    assert.equal(
      resolveSearchBaseUrl(config, {
        ...base,
        providerSpecificData: { baseUrl: "http://127.0.0.1:9999" },
      }),
      "http://127.0.0.1:9999"
    );
    assert.equal(
      resolveSearchBaseUrl(config, {
        ...base,
        providerSpecificData: { baseUrl: "http://10.0.0.5:8080" },
      }),
      "http://10.0.0.5:8080"
    );
  });

  it("leaves the catalog baseUrl untouched when no override is supplied", () => {
    assert.equal(resolveSearchBaseUrl(config, base), "http://127.0.0.1:8888");
  });
});

describe("fetchClientControlledSearchUrl — request-time SSRF guard", () => {
  it("rejects a public hostname whose DNS answer is private before connecting", async () => {
    let fetchCreated = false;

    await assert.rejects(
      () =>
        fetchClientControlledSearchUrl("https://search.example.test/query", {}, undefined, {
          lookup: async () => [{ address: "169.254.169.254", family: 4 }],
          createPinnedFetch: () => {
            fetchCreated = true;
            return async () => new Response("unexpected");
          },
        }),
      /private|metadata|DNS rebinding/i
    );

    assert.equal(fetchCreated, false);
  });

  it("pins the connection to the public DNS answer that passed validation", async () => {
    let pinnedAddress = "";
    let pinnedFamily = 0;

    const response = await fetchClientControlledSearchUrl(
      "https://search.example.test/query",
      { method: "POST", body: "{}" },
      undefined,
      {
        lookup: async () => [{ address: "203.0.113.42", family: 4 }],
        createPinnedFetch: (address, family) => {
          pinnedAddress = address;
          pinnedFamily = family;
          return async (_input, init) => {
            assert.equal(init?.redirect, "manual");
            return new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          };
        },
      }
    );

    assert.equal(response.status, 200);
    assert.equal(pinnedAddress, "203.0.113.42");
    assert.equal(pinnedFamily, 4);
  });

  it("blocks redirects instead of letting fetch follow a public URL into metadata", async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        fetchClientControlledSearchUrl("https://search.example.test/query", {}, undefined, {
          lookup: async () => [{ address: "203.0.113.42", family: 4 }],
          createPinnedFetch: () => async (_input, init) => {
            calls += 1;
            assert.equal(init?.redirect, "manual");
            return new Response(null, {
              status: 302,
              headers: {
                location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
              },
            });
          },
        }),
      /redirect blocked/i
    );

    assert.equal(calls, 1, "the redirect target must never be requested");
  });
});
