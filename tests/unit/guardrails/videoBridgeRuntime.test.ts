import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFrameTimestamps,
  extractFramesFromLocalVideo,
  probeLocalVideo,
  probeVideoRuntime,
  resetVideoRuntimeProbeCacheForTests,
  type VideoCommandRunner,
} from "../../../src/lib/guardrails/videoBridgeRuntime.ts";

test("calculates uniform midpoint timestamps", () => {
  assert.deepEqual(calculateFrameTimestamps(8, 4), [1, 3, 5, 7]);
  assert.deepEqual(calculateFrameTimestamps(0.4, 8), [0.2]);
});

test("probes and extracts a local video using shell-free bounded commands", async () => {
  const calls: Array<{ executable: string; args: string[]; timeoutMs: number }> = [];
  const runner: VideoCommandRunner = async (executable, args, options) => {
    calls.push({ executable, args: [...args], timeoutMs: options.timeoutMs });
    if (executable === "ffprobe") {
      return { stdout: JSON.stringify({ format: { duration: "8.0" } }), stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };

  const metadata = await probeLocalVideo("/tmp/input.mp4", {
    maxDurationSeconds: 600,
    runner,
    timeoutMs: 5_000,
  });
  const frames = await extractFramesFromLocalVideo("/tmp/input.mp4", "/tmp/frames", {
    durationSeconds: metadata.durationSeconds,
    frameCount: 4,
    runner,
    timeoutMs: 10_000,
  });

  assert.equal(metadata.durationSeconds, 8);
  assert.deepEqual(
    frames.map((frame) => frame.timestampSeconds),
    [1, 3, 5, 7]
  );
  assert.deepEqual(calls[0], {
    executable: "ffprobe",
    args: ["-v", "error", "-show_entries", "format=duration", "-of", "json", "/tmp/input.mp4"],
    timeoutMs: 5_000,
  });
  assert.equal(
    calls.slice(1).every((call) => call.executable === "ffmpeg"),
    true
  );
  assert.equal(
    calls.slice(1).every((call) => call.args.includes("-nostdin")),
    true
  );
  assert.equal(
    calls.slice(1).every((call) => !call.args.some((arg) => arg.includes("://"))),
    true
  );
});

test("rejects remote process inputs and videos beyond the duration bound", async () => {
  const runner: VideoCommandRunner = async () => ({
    stdout: JSON.stringify({ format: { duration: "601" } }),
    stderr: "private upstream details",
  });
  await assert.rejects(
    () => probeLocalVideo("https://example.test/video.mp4", { runner }),
    /local path/
  );
  await assert.rejects(
    () => probeLocalVideo("/tmp/input.mp4", { maxDurationSeconds: 600, runner }),
    /maximum duration/
  );
});

test("runtime status exposes sanitized versions and a sanitized unavailable reason", async () => {
  resetVideoRuntimeProbeCacheForTests();
  const ready = await probeVideoRuntime({
    cacheTtlMs: 0,
    runner: async (executable) => ({
      stdout:
        executable === "ffmpeg" ? "ffmpeg version 6.1.1 secret" : "ffprobe version 6.1.1 secret",
      stderr: "",
    }),
  });
  assert.deepEqual(ready, {
    available: true,
    ffmpegVersion: "6.1.1",
    ffprobeVersion: "6.1.1",
  });

  resetVideoRuntimeProbeCacheForTests();
  const unavailable = await probeVideoRuntime({
    cacheTtlMs: 0,
    runner: async () => {
      throw new Error("spawn /private/operator/path ENOENT");
    },
  });
  assert.deepEqual(unavailable, {
    available: false,
    ffmpegVersion: null,
    ffprobeVersion: null,
    reason: "FFmpeg and ffprobe are not available on PATH",
  });
});

test("runtime probe uses its short cache instead of spawning on every status read", async () => {
  resetVideoRuntimeProbeCacheForTests();
  let calls = 0;
  const runner: VideoCommandRunner = async (executable) => {
    calls += 1;
    return {
      stdout: `${executable} version 7.0`,
      stderr: "",
    };
  };

  const first = await probeVideoRuntime({ cacheTtlMs: 30_000, runner });
  const second = await probeVideoRuntime({ cacheTtlMs: 30_000, runner });
  assert.deepEqual(second, first);
  assert.equal(calls, 2, "one ffmpeg + one ffprobe process should serve both reads");
});
