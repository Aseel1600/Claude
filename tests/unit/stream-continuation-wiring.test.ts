import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createRecoverableStream,
  scanOpenAiSseText,
} from "../../open-sse/services/streamRecovery.ts";

const enc = new TextEncoder();

/** A clock that jumps +1000ms per call so the holdback commits on the very first chunk. */
function steppingClock() {
  let t = 0;
  return () => {
    t += 1000;
    return t;
  };
}

/** Build a ReadableStream from string chunks, optionally erroring (truncating) at the end. */
function streamFrom(chunks: string[], opts: { truncateError?: Error } = {}) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
        return;
      }
      if (opts.truncateError) controller.error(opts.truncateError);
      else controller.close();
    },
  });
}

async function collectText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += dec.decode(value, { stream: true });
  }
  return out;
}

const ROLE = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n';
const content = (s: string) => `data: {"choices":[{"delta":{"content":${JSON.stringify(s)}}}]}\n\n`;
const reasoning = (s: string) =>
  `data: {"choices":[{"delta":{"reasoning_content":${JSON.stringify(s)}}}]}\n\n`;
const finishStopNoContent = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const finishLengthNoContent = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n';

test("mid-stream continuation: stitches the suffix after a silent post-commit truncation", async () => {
  // Commits on chunk 1, emits "Hello wor", then ends WITHOUT a terminal marker (silent cut).
  const initial = streamFrom([ROLE, content("Hello wor")]);
  let finalizeCount = 0;
  let continueArg = "";

  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {
      finalizeCount += 1;
    },
    now: steppingClock(),
    continueStream: async (soFar: string) => {
      continueArg = soFar;
      // The model re-emits a small overlap ("wor") which must be trimmed away.
      return streamFrom([ROLE, content("world!"), "data: [DONE]\n\n"]);
    },
  });

  const out = await collectText(stream);
  const scan = scanOpenAiSseText(out);
  assert.equal(continueArg, "Hello wor", "continuation is prefilled with the text already sent");
  assert.equal(scan.text, "Hello world!", "client sees the full answer, overlap trimmed, exactly once");
  assert.equal(scan.terminal, true, "the recovered stream ends with a terminal marker");
  assert.equal(finalizeCount, 1, "finalize runs exactly once");
});

test("mid-stream continuation: recovers a post-commit transport error too", async () => {
  const initial = streamFrom([ROLE, content("Partial ")], {
    truncateError: Object.assign(new Error("terminated"), { code: "UND_ERR_SOCKET" }),
  });
  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {},
    now: steppingClock(),
    continueStream: async () => streamFrom([content("answer done."), "data: [DONE]\n\n"]),
  });
  const scan = scanOpenAiSseText(await collectText(stream));
  assert.equal(scan.text, "Partial answer done.");
  assert.equal(scan.terminal, true);
});

test("no continuation configured: a silent post-commit truncation closes as before (no recovery)", async () => {
  const initial = streamFrom([ROLE, content("Hello wor")]);
  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {},
    now: steppingClock(),
    // continueStream omitted → behavior unchanged from #4131
  });
  const scan = scanOpenAiSseText(await collectText(stream));
  assert.equal(scan.text, "Hello wor", "only the committed text is delivered");
  assert.equal(scan.terminal, false, "no synthetic terminal is injected when continuation is off");
});

test("tool-call in flight is never continued (would corrupt tool JSON)", async () => {
  const toolDelta =
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"f","arguments":"{\\"a\\":"}}]}}]}\n\n';
  const initial = streamFrom([ROLE, toolDelta]); // commits, emits a partial tool call, then truncates
  let continued = false;
  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {},
    now: steppingClock(),
    continueStream: async () => {
      continued = true;
      return streamFrom([content("nope"), "data: [DONE]\n\n"]);
    },
  });
  await collectText(stream);
  assert.equal(continued, false, "continuation must NOT fire once a tool call has started streaming");
});

test("mid-stream continuation: a clean stop with reasoning-only output (no answer) triggers a continuation", async () => {
  const initial = streamFrom([
    ROLE,
    reasoning("the model thinks through the problem here..."),
    finishStopNoContent,
  ]);
  let continueArg = "__unset__";
  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {},
    now: steppingClock(),
    continueStream: async (soFar: string) => {
      continueArg = soFar;
      return streamFrom([content("Here is the actual answer."), "data: [DONE]\n\n"]);
    },
  });
  const out = await collectText(stream);
  const scan = scanOpenAiSseText(out);
  assert.equal(continueArg, "", "nothing usable was emitted — the re-request has an empty prefill");
  assert.equal(
    scan.text,
    "Here is the actual answer.",
    "the client gets a real answer instead of silence"
  );
  assert.equal(scan.terminal, true);
});

test("mid-stream continuation: a clean stop with truly empty output (no text, no reasoning) is left unchanged", async () => {
  const initial = streamFrom([ROLE, finishStopNoContent]);
  let continued = false;
  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {},
    now: steppingClock(),
    continueStream: async () => {
      continued = true;
      return streamFrom([content("nope"), "data: [DONE]\n\n"]);
    },
  });
  await collectText(stream);
  assert.equal(
    continued,
    false,
    "no reasoning trace means there is nothing to act on — do not guess"
  );
});

test("mid-stream continuation: finish_reason 'length' with reasoning-only output does NOT trigger a continuation", async () => {
  // Regression guard for a blocker found in cross-review: widening the gate to any
  // terminal marker (instead of the literal finish_reason "stop") would wrongly spend a
  // continuation attempt on a token-limit cutoff, which is out of this fix's scope.
  const initial = streamFrom([
    ROLE,
    reasoning("the model was still thinking when it hit the token limit..."),
    finishLengthNoContent,
  ]);
  let continued = false;
  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {},
    now: steppingClock(),
    continueStream: async () => {
      continued = true;
      return streamFrom([content("nope"), "data: [DONE]\n\n"]);
    },
  });
  await collectText(stream);
  assert.equal(continued, false, "finish_reason 'length' is out of scope for this fix");
});

test("mid-stream continuation: real content alongside reasoning at a clean stop is left unchanged (non-regression)", async () => {
  const initial = streamFrom([
    ROLE,
    reasoning("thinking..."),
    content("The real answer."),
    finishStopNoContent,
  ]);
  let continued = false;
  const stream = createRecoverableStream(initial, async () => null, {
    finalize: () => {},
    now: steppingClock(),
    continueStream: async () => {
      continued = true;
      return streamFrom([content("nope"), "data: [DONE]\n\n"]);
    },
  });
  const scan = scanOpenAiSseText(await collectText(stream));
  assert.equal(continued, false, "real content was delivered — nothing to recover");
  assert.equal(scan.text, "The real answer.");
});
