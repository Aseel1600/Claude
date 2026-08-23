import assert from "node:assert/strict";
import test from "node:test";

import { executeImageWithCredentialFallback } from "../../src/sse/services/imageCredentialRetry.ts";

test("image credential retries stay within the connections advertising the endpoint model", async () => {
  const allowedConnectionIds = ["image-a", "image-b"];
  let observedAllowedConnectionIds: string[] | null | undefined;

  const result = await executeImageWithCredentialFallback({
    provider: "ollama-local",
    requestedModel: "flux-dev",
    allowedConnectionIds,
    credentials: { connectionId: "image-a" },
    execute: async () => ({ success: false, status: 401 }),
    selectNextCredentials: async (_provider, _model, _excluded, allowed) => {
      observedAllowedConnectionIds = allowed;
      return null;
    },
  });

  assert.deepEqual(observedAllowedConnectionIds, allowedConnectionIds);
  assert.equal(result.result.status, 401);
});
