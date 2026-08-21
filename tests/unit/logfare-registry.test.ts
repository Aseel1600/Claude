import test from "node:test";
import assert from "node:assert/strict";

import { logfareProvider } from "../../open-sse/config/providers/registry/logfare/index.ts";

test("logfareProvider registry entry has correct configuration", () => {
  assert.equal(logfareProvider.id, "logfare");
  assert.equal(logfareProvider.alias, "logfare");
  assert.equal(logfareProvider.format, "openai");
  assert.equal(logfareProvider.executor, "default");
  assert.equal(
    logfareProvider.baseUrl,
    "https://logfare.ai/v1/chat/completions",
  );
  assert.equal(logfareProvider.modelsUrl, "https://logfare.ai/v1/models");
  assert.equal(logfareProvider.authType, "apikey");
  assert.equal(logfareProvider.authHeader, "bearer");
  // Catalog is discovered live from /v1/models; no hardcoded seed.
  assert.equal(logfareProvider.passthroughModels, true);
  assert.equal(logfareProvider.models.length, 0);
});
