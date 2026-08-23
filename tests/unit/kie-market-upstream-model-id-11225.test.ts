import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "omniroute-kie-11225-"));

const { handleImageGeneration } = await import("../../open-sse/handlers/imageGeneration.ts");

/**
 * Issue #11225 — KIE Market public model IDs are namespaced for the OmniRoute
 * catalog (`kie/google-imagen/nano-banana-2`), but the KIE Market createTask
 * API expects the bare upstream model ID `nano-banana-2`. Sending the
 * namespaced id makes upstream reject the task.
 *
 * The mapping must be an explicit seam: other KIE Market ids such as
 * `seedream/4.5-text-to-image` ARE the real upstream ids and must pass through
 * unchanged, so a generic "strip everything before the slash" is wrong.
 *
 * These tests drive the real public `handleImageGeneration` entrypoint and
 * capture the payload at the final executor boundary (`fetch` to
 * `/api/v1/jobs/createTask`). No credentials, no network, no production data.
 */

interface CapturedCreate {
  url: string;
  body: Record<string, unknown>;
}

async function runKieMarketGeneration(publicModel: string): Promise<CapturedCreate> {
  const originalFetch = globalThis.fetch;
  let captured: CapturedCreate | undefined;

  globalThis.fetch = (async (url: unknown, options: { body?: unknown } = {}) => {
    const stringUrl = String(url);

    if (stringUrl === "https://api.kie.ai/api/v1/jobs/createTask") {
      captured = {
        url: stringUrl,
        body: JSON.parse(String(options.body ?? "{}")) as Record<string, unknown>,
      };
      return new Response(JSON.stringify({ code: 200, data: { taskId: "kie-market-task-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (stringUrl.startsWith("https://api.kie.ai/api/v1/jobs/recordInfo")) {
      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            state: "success",
            resultJson: JSON.stringify({
              resultUrls: ["https://example.com/kie-market-image.png"],
            }),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected URL: ${stringUrl}`);
  }) as typeof globalThis.fetch;

  try {
    const result = await handleImageGeneration({
      body: {
        model: publicModel,
        prompt: "a calm harbour at sunrise",
        size: "1024x1024",
        n: 1,
      },
      credentials: { apiKey: "test-kie-key" },
      log: null,
    });

    assert.equal(result.success, true, "KIE Market generation should succeed against the stub");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(captured, "expected a createTask request to be captured");
  return captured;
}

test("KIE Market createTask sends the bare upstream model id for Nano Banana 2 (#11225)", async () => {
  const captured = await runKieMarketGeneration("kie/google-imagen/nano-banana-2");

  assert.equal(
    captured.body.model,
    "nano-banana-2",
    "KIE Market createTask must send the upstream model id, not the namespaced catalog id"
  );

  const input = captured.body.input as Record<string, unknown>;
  assert.equal(input.prompt, "a calm harbour at sunrise");
  assert.equal(input.aspect_ratio, "1:1");
});

test("KIE Market createTask leaves genuinely namespaced upstream ids untouched (#11225 control)", async () => {
  const captured = await runKieMarketGeneration("kie/seedream/4.5-text-to-image");

  assert.equal(
    captured.body.model,
    "seedream/4.5-text-to-image",
    "seedream/4.5-text-to-image IS the upstream id and must not be stripped"
  );

  const input = captured.body.input as Record<string, unknown>;
  assert.equal(input.prompt, "a calm harbour at sunrise");
  assert.equal(input.aspect_ratio, "1:1");
});
