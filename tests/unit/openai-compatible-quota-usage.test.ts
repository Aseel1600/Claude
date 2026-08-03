import test from "node:test";
import assert from "node:assert/strict";

import { getOpenAiCompatibleQuotaUsage } from "../../open-sse/services/usage/openaiCompatibleQuota";

type MockResponse = {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  jsonBody?: unknown;
};

function makeResponse(input: MockResponse): Response {
  return {
    ok: input.ok,
    status: input.status,
    headers: {
      get(name: string) {
        return input.headers?.[name] ?? input.headers?.[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return input.jsonBody;
    },
  } as unknown as Response;
}

test("fetches and normalizes TCB quota windows from the official codex-auth quota endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return makeResponse({
      ok: true,
      status: 200,
      jsonBody: {
        usage: {
          fiveHour: { percentRemaining: 83.539, windowEnd: "2026-08-03T18:00:00.000Z" },
          weekly: { percentRemaining: 72.196, windowEnd: "2026-08-10T10:37:15.837Z" },
        },
      },
    });
  };

  try {
    const result = await getOpenAiCompatibleQuotaUsage("openai-compatible-chat-123", "sk-test", {
      baseUrl: "https://api.theclawbay.com/v1",
    });

    assert.ok(result);
    assert.deepEqual(calls, ["https://theclawbay.com/api/codex-auth/v1/quota"]);
    assert.ok(result?.quotas);
    assert.equal(result?.plan, "Enterprise");
    assert.equal(result?.quotas?.["5 Hours Quota"]?.remainingPercentage, 83.539);
    assert.equal(result?.quotas?.["Weekly Quota"]?.remainingPercentage, 72.196);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back from root /quota to baseUrl/quota for Verboo", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return makeResponse({ ok: false, status: 404 });
    }
    return makeResponse({
      ok: true,
      status: 200,
      jsonBody: {
        weekly: { used: 20, total: 100, resetAt: "2026-08-09T00:00:00Z" },
        session: { used: 10, total: 100, resetAt: "2026-08-03T10:00:00Z" },
      },
    });
  };

  try {
    const result = await getOpenAiCompatibleQuotaUsage("openai-compatible-chat-456", "sk-test", {
      baseUrl: "https://code.verboo.ai/router/v1",
    });

    assert.ok(result);
    assert.deepEqual(calls, [
      "https://code.verboo.ai/quota",
      "https://code.verboo.ai/router/v1/quota",
    ]);
    assert.equal(result?.plan, "Verboo");
    assert.equal(result?.quotas?.["session (5h)"]?.remainingPercentage, 90);
    assert.equal(result?.quotas?.["weekly (7d)"]?.remainingPercentage, 80);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
