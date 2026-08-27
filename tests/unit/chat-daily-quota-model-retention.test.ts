import assert from "node:assert/strict";
import test from "node:test";

import { resolveDailyQuotaLockoutModel } from "../../src/sse/handlers/chatPredicates.ts";

test("daily quota model uses the upstream model token for ordinary requests", () => {
  assert.equal(
    resolveDailyQuotaLockoutModel(
      "You have exceeded today's quota for model moonshotai/Kimi-K2.5, try tomorrow",
      "Kimi-K2.5",
      false
    ),
    "moonshotai/Kimi-K2.5"
  );
});

test("daily quota model never persists a transcript echo for a sensitive video request", () => {
  const transcriptSentinel = "PRIVATE_DAILY_QUOTA_TRANSCRIPT_SENTINEL";
  const resolved = resolveDailyQuotaLockoutModel(
    `You have exceeded today's quota for model ${transcriptSentinel}, try tomorrow`,
    "server-resolved-model",
    true
  );

  assert.equal(resolved, "server-resolved-model");
  assert.equal(resolved.includes(transcriptSentinel), false);
});

test("daily quota model falls back to the server-resolved model when no token is present", () => {
  assert.equal(
    resolveDailyQuotaLockoutModel("daily quota exhausted", "server-resolved-model", false),
    "server-resolved-model"
  );
});
