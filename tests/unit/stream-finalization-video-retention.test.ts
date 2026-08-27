import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-stream-retention-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const usageHistory = await import("../../src/lib/usage/usageHistory.ts");
const { finalizeStreamRequestLog } =
  await import("../../open-sse/utils/streamFailureFinalization.ts");

test.after(() => {
  usageHistory.clearPendingRequests();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { force: true, recursive: true });
});

test("stream finalization omits transcript-sensitive response echoes", () => {
  usageHistory.clearPendingRequests();
  const sentinel = "PRIVATE_STREAM_FINALIZATION_TRANSCRIPT_SENTINEL";
  const requestId = usageHistory.trackPendingRequest(
    "video-model",
    "video-provider",
    "video-connection",
    true,
    { videoTranscriptSensitive: true }
  );
  assert.ok(requestId);

  finalizeStreamRequestLog({
    pendingRequestId: requestId,
    model: "video-model",
    provider: "video-provider",
    connectionId: "video-connection",
    providerResponse: { echo: sentinel },
    clientResponse: { echo: sentinel },
    status: 502,
    error: sentinel,
    videoTranscriptSensitive: true,
  });

  const retained = usageHistory.getCompletedDetails().get(requestId);
  assert.ok(retained);
  const serialized = JSON.stringify(retained);
  assert.equal(serialized.includes(sentinel), false);
  assert.match(serialized, /omitted: video transcript/);
});

test("chatCore propagates the request sensitivity bit into stream finalization", () => {
  const source = fs.readFileSync("open-sse/handlers/chatCore.ts", "utf8");
  const callStart = source.indexOf("streamFailure.finalizeStreamRequestLog({");
  assert.notEqual(callStart, -1, "stream finalization call must exist");
  const callEnd = source.indexOf("\n    });", callStart);
  assert.notEqual(callEnd, -1, "stream finalization call must be bounded");
  const callSource = source.slice(callStart, callEnd);

  assert.match(callSource, /\n\s+videoTranscriptSensitive,\s*$/m);
});
