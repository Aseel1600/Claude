import assert from "node:assert/strict";
import test from "node:test";

import { enrichModel, parseAgentPlanModels } from "@/lib/providers/volcenginePlanModelDiscovery";

test("Agent Plan discovery keeps canonical API-callable models hidden by the console", () => {
  const models = parseAgentPlanModels({
    Result: {
      Data: [
        {
          RespModelID: "doubao-seed-evolving",
          RespModelName: "doubao-seed-evolving",
          PlatformAllowStatus: true,
          Type: "llm",
        },
        {
          RespModelID: "kimi-k3",
          PlatformAllowStatus: false,
          Type: null,
        },
        {
          RespModelID: "minimax-m3",
          PlatformAllowStatus: false,
          Type: null,
        },
      ],
    },
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ["doubao-seed-evolving", "kimi-k3", "minimax-m3"]
  );
});

test("Agent Plan discovery excludes disabled aliases, auto-routing, and non-chat models", () => {
  const models = parseAgentPlanModels({
    Result: {
      Data: [
        {
          RespModelID: "future-platform-model",
          PlatformAllowStatus: true,
          Type: "llm",
        },
        {
          RespModelID: "glm-5.2",
          PlatformAllowStatus: false,
          Type: null,
        },
        {
          RespModelID: "auto",
          PlatformAllowStatus: false,
          Type: null,
        },
        {
          RespModelID: "doubao-seed-tts-2.0",
          PlatformAllowStatus: true,
          Type: "audio",
        },
      ],
    },
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ["future-platform-model"]
  );
});

test("Agent Plan canonical Kimi K3 receives registry-equivalent capabilities", () => {
  const kimi = enrichModel({ id: "kimi-k3", name: "kimi-k3" });

  assert.equal(kimi.inputTokenLimit, 1048576);
  assert.equal(kimi.supportsVision, true);
  assert.equal(kimi.supportsTools, true);
  assert.equal(kimi.supportsThinking, true);
});
