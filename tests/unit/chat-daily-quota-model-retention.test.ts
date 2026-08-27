import assert from "node:assert/strict";
import test from "node:test";

import { resolveDailyQuotaModelViews } from "../../src/sse/handlers/chatPredicates.ts";

test("daily quota model uses the upstream model token for ordinary operational and retained views", () => {
  assert.deepEqual(
    resolveDailyQuotaModelViews(
      "You have exceeded today's quota for model moonshotai/Kimi-K2.5, try tomorrow",
      "Kimi-K2.5",
      false
    ),
    {
      operationalModel: "moonshotai/Kimi-K2.5",
      retainedModel: "moonshotai/Kimi-K2.5",
    }
  );
});

test("daily quota keeps the raw operational key but redacts its retained sensitive view", () => {
  const transcriptSentinel = "PRIVATE_DAILY_QUOTA_TRANSCRIPT_SENTINEL";
  const views = resolveDailyQuotaModelViews(
    `You have exceeded today's quota for model ${transcriptSentinel}, try tomorrow`,
    "server-resolved-model",
    true
  );

  assert.equal(views.operationalModel, transcriptSentinel);
  assert.equal(views.retainedModel, "[omitted: video transcript]");
  assert.equal(views.retainedModel.includes(transcriptSentinel), false);
});

test("daily quota model falls back to the server-resolved model when no token is present", () => {
  assert.deepEqual(
    resolveDailyQuotaModelViews("daily quota exhausted", "server-resolved-model", true),
    {
      operationalModel: "server-resolved-model",
      retainedModel: "server-resolved-model",
    }
  );
});
