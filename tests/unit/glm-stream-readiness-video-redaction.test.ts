import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-glm-video-redaction-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { GlmExecutor } = await import("../../open-sse/executors/glm.ts");

test.after(() => {
  fs.rmSync(TEST_DATA_DIR, { force: true, recursive: true });
});

test("GLM stream readiness keeps the operational diagnostic but omits it from retained logs", async () => {
  const sentinel = "PRIVATE_GLM_STREAM_TRANSCRIPT_SENTINEL";
  const retainedWarnings: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(`data: ${JSON.stringify({ error: { message: sentinel } })}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

  try {
    const executor = new GlmExecutor("glm");
    const result = await executor.execute({
      model: "glm-5.3-high",
      body: {
        model: "glm-5.3-high",
        messages: [{ role: "user", content: "describe the video" }],
      },
      stream: true,
      credentials: {
        apiKey: "glm-key",
        providerSpecificData: {
          baseUrl: "https://api.z.ai/api/coding/paas/v4",
          primaryTransport: "openai",
        },
      },
      videoTranscriptSensitive: true,
      log: {
        warn: (_tag, message) => retainedWarnings.push(message),
      },
    });

    assert.equal(result.response.status, 502);
    const operationalBody = await result.response.text();
    assert.match(
      operationalBody,
      new RegExp(sentinel),
      "the transient operational response must retain the upstream diagnostic"
    );
    assert.equal(retainedWarnings.length, 1);
    assert.doesNotMatch(retainedWarnings[0], new RegExp(sentinel));
    assert.match(retainedWarnings[0], /upstream diagnostic omitted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCore propagates video transcript sensitivity to every executor dispatch", () => {
  const source = fs.readFileSync("open-sse/handlers/chatCore.ts", "utf8");
  const lines = source.split("\n");
  const callLines = lines.flatMap((line, index) =>
    line.includes("executor.execute({") ? [index] : []
  );

  assert.equal(callLines.length, 3, "the source contract expects all three executor dispatches");
  for (const callLine of callLines) {
    const contextEditingLine = lines.findIndex(
      (line, index) => index >= callLine && line.includes("contextEditing:")
    );
    assert.ok(
      contextEditingLine > callLine && contextEditingLine - callLine < 30,
      "executor dispatch must have a bounded ExecuteInput object"
    );
    const callSource = lines.slice(callLine, contextEditingLine + 1).join("\n");
    assert.match(callSource, /\n\s+videoTranscriptSensitive,\s*$/m);
  }
});
