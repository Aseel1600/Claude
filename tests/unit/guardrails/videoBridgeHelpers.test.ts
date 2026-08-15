import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  describeVideoPart,
  extractVideoParts,
  replaceVideoParts,
} from "../../../src/lib/guardrails/videoBridgeHelpers.ts";
import type { VideoCommandRunner } from "../../../src/lib/guardrails/videoBridgeRuntime.ts";

test("extracts and replaces video parts in Chat and Responses payloads without shifting siblings", () => {
  const chatBody = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "before" },
          { type: "input_video", video_url: "data:video/mp4;base64,QUJD" },
          { type: "text", text: "after" },
        ],
      },
    ],
  };
  const chatParts = extractVideoParts(chatBody);
  assert.equal(chatParts.length, 1);
  assert.equal(chatParts[0].container, "messages");
  assert.deepEqual(
    replaceVideoParts(chatBody, chatParts, ["[Video description: frame@t=00:01.000 demo]"])
      .messages[0].content,
    [
      { type: "text", text: "before" },
      { type: "text", text: "[Video description: frame@t=00:01.000 demo]" },
      { type: "text", text: "after" },
    ]
  );

  const responsesBody = {
    input: [
      {
        role: "user",
        content: [{ type: "video_url", video_url: { url: "https://example.test/a.mp4" } }],
      },
    ],
  };
  const responseParts = extractVideoParts(responsesBody);
  assert.equal(responseParts[0].container, "input");
  assert.deepEqual(
    replaceVideoParts(responsesBody, responseParts, ["description"]).input[0].content,
    [{ type: "input_text", text: "description" }]
  );
});

test("downloads bytes before ffmpeg, captions frames sequentially, and removes temporary files", async () => {
  const commandArgs: string[][] = [];
  let temporaryInput = "";
  const runner: VideoCommandRunner = async (executable, args) => {
    commandArgs.push([...args]);
    if (executable === "ffprobe") {
      temporaryInput = args.at(-1) ?? "";
      return { stdout: JSON.stringify({ format: { duration: "4" } }), stderr: "" };
    }
    await writeFile(args.at(-1) ?? "", Buffer.from(`jpeg-${commandArgs.length}`));
    return { stdout: "", stderr: "" };
  };
  const captionOrder: string[] = [];
  const result = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "https://example.test/private.mp4",
      shape: "video_url",
    },
    {
      frameCount: 2,
      maxBytes: 1024,
      maxDurationSeconds: 600,
      timeoutMs: 20_000,
    },
    async (frame, timestampSeconds) => {
      captionOrder.push(`${timestampSeconds}:${frame.slice(0, 20)}`);
      return timestampSeconds < 2 ? "first frame" : "second frame";
    },
    {
      fetchRemote: async () => ({
        buffer: Buffer.from("downloaded-video"),
        contentType: "video/mp4",
        url: "https://example.test/private.mp4",
      }),
      runner,
    }
  );

  assert.equal(
    result.description,
    "[Video description: frame@t=00:01.000 first frame; frame@t=00:03.000 second frame]"
  );
  assert.equal(result.framesUsed, 2);
  assert.deepEqual(
    captionOrder.map((entry) => entry.split(":", 1)[0]),
    ["1", "3"]
  );
  assert.equal(
    commandArgs.every((args) => !args.some((arg) => arg.includes("example.test"))),
    true
  );
  await assert.rejects(() => access(temporaryInput));
});

test("rejects oversized video data before invoking the process boundary", async () => {
  let called = false;
  await assert.rejects(
    () =>
      describeVideoPart(
        {
          container: "messages",
          messageIndex: 0,
          partIndex: 0,
          ref: "data:video/mp4;base64,QUJDRA==",
          shape: "input_video",
        },
        { frameCount: 1, maxBytes: 2, maxDurationSeconds: 600, timeoutMs: 5_000 },
        async () => "unused",
        {
          runner: async () => {
            called = true;
            return { stdout: "", stderr: "" };
          },
        }
      ),
    /maximum size/
  );
  assert.equal(called, false);
});

test("keeps successful captions after a partial frame failure and still cleans up", async () => {
  let temporaryInput = "";
  const runner: VideoCommandRunner = async (executable, args) => {
    if (executable === "ffprobe") {
      temporaryInput = args.at(-1) ?? "";
      return { stdout: JSON.stringify({ format: { duration: "4" } }), stderr: "" };
    }
    await writeFile(args.at(-1) ?? "", Buffer.from("jpeg"));
    return { stdout: "", stderr: "" };
  };
  let captionCalls = 0;
  const result = await describeVideoPart(
    {
      container: "messages",
      messageIndex: 0,
      partIndex: 0,
      ref: "data:video/mp4;base64,QUJD",
      shape: "input_video",
    },
    { frameCount: 2, timeoutMs: 5_000 },
    async () => {
      captionCalls += 1;
      if (captionCalls === 1) throw new Error("one frame failed");
      return "usable second frame";
    },
    { runner }
  );

  assert.equal(result.description, "[Video description: frame@t=00:03.000 usable second frame]");
  assert.equal(result.framesRequested, 2);
  assert.equal(result.framesUsed, 1);
  await assert.rejects(() => access(temporaryInput));
});

test("propagates abort as a sanitized error and removes the temporary tree", async () => {
  const controller = new AbortController();
  controller.abort();
  let temporaryInput = "";
  await assert.rejects(
    () =>
      describeVideoPart(
        {
          container: "messages",
          messageIndex: 0,
          partIndex: 0,
          ref: "data:video/mp4;base64,QUJD",
          shape: "input_video",
        },
        { frameCount: 1, signal: controller.signal, timeoutMs: 5_000 },
        async () => "unused",
        {
          runner: async (_executable, args, options) => {
            temporaryInput = args.at(-1) ?? "";
            assert.equal(options.signal?.aborted, true);
            throw new Error("private process detail");
          },
        }
      ),
    /processing timed out or was aborted/
  );
  await assert.rejects(() => access(temporaryInput));
});

test("aborts an in-flight caption at the total video deadline without starting later frames", async () => {
  let temporaryInput = "";
  let captionCalls = 0;
  const runner: VideoCommandRunner = async (executable, args) => {
    if (executable === "ffprobe") {
      temporaryInput = args.at(-1) ?? "";
      return { stdout: JSON.stringify({ format: { duration: "4" } }), stderr: "" };
    }
    await writeFile(args.at(-1) ?? "", Buffer.from("jpeg"));
    return { stdout: "", stderr: "" };
  };

  await assert.rejects(
    () =>
      describeVideoPart(
        {
          container: "messages",
          messageIndex: 0,
          partIndex: 0,
          ref: "data:video/mp4;base64,QUJD",
          shape: "input_video",
        },
        { frameCount: 2, timeoutMs: 25 },
        async (_frame, _timestampSeconds, signal) => {
          captionCalls += 1;
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                const error = new Error("private caption transport detail");
                error.name = "AbortError";
                reject(error);
              },
              { once: true }
            );
          });
        },
        { runner }
      ),
    /processing timed out or was aborted/
  );

  assert.equal(captionCalls, 1, "the shared deadline must stop sequential frame captioning");
  await assert.rejects(() => access(temporaryInput));
});
