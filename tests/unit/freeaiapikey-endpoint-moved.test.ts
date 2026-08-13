import assert from "node:assert/strict";
import { test } from "node:test";
import { freeaiapikeyProvider } from "../../open-sse/config/providers/registry/freeaiapikey/index.ts";

/**
 * FreeAIAPIKey retired its apex-host API and moved it to a dedicated `api.` host.
 *
 * Live probe (2026-08-13), each paired with a control call so a network fault
 * cannot be mistaken for an upstream verdict:
 *
 *   GET https://freeaiapikey.com/v1/models               → 410
 *   GET https://freeaiapikey.com/v1/chat/completions     → 410
 *   GET https://api.freeaiapikey.com/v1/models           → 200
 *   GET https://api.freeaiapikey.com/v1/chat/completions → 405   (POST-only endpoint)
 *   GET https://api.openai.com/v1/models                 → 401   (control: reachable)
 *   GET https://<nonexistent-domain>/v1/models           → 000   (control: unreachable)
 *
 * The 410 body names its own replacement, so the target host is upstream's own
 * instruction rather than an inference:
 *
 *   {"error":{"message":"This API endpoint has moved. Please update your base_url
 *    to https://api.freeaiapikey.com/v1 — the old endpoint on freeaiapikey.com no
 *    longer works.","type":"endpoint_moved","code":"endpoint_moved"}}
 *
 * Provider entry added in #2708.
 */
const LIVE_API_BASE = "https://api.freeaiapikey.com/v1";

test("freeaiapikey targets the live api. host (upstream 410 endpoint_moved)", () => {
  assert.equal(
    freeaiapikeyProvider.baseUrl,
    `${LIVE_API_BASE}/chat/completions`,
    "baseUrl must point at the host named in upstream's 410 endpoint_moved body"
  );
  assert.equal(
    freeaiapikeyProvider.modelsUrl,
    `${LIVE_API_BASE}/models`,
    "modelsUrl must point at the host named in upstream's 410 endpoint_moved body"
  );
});

test("freeaiapikey keeps no endpoint on the retired freeaiapikey.com apex host", () => {
  for (const [field, url] of [
    ["baseUrl", freeaiapikeyProvider.baseUrl],
    ["modelsUrl", freeaiapikeyProvider.modelsUrl],
  ] as const) {
    assert.ok(url, `${field} must be set`);
    assert.doesNotMatch(
      url,
      /^https:\/\/freeaiapikey\.com\//,
      `${field} still targets the apex host, which answers 410 endpoint_moved`
    );
  }
});
