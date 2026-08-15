import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VideoCommandOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export type VideoCommandRunner = (
  executable: "ffmpeg" | "ffprobe",
  args: readonly string[],
  options: VideoCommandOptions
) => Promise<{ stdout: string; stderr: string }>;

export interface VideoRuntimeStatus {
  available: boolean;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  reason?: string;
}

export interface VideoFrameFile {
  path: string;
  timestampSeconds: number;
}

const defaultRunner: VideoCommandRunner = async (executable, args, options) => {
  const result = await execFileAsync(executable, [...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    signal: options.signal,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

function assertLocalPath(filePath: string): void {
  if (!isAbsolute(filePath) || filePath.includes("\0") || filePath.includes("://")) {
    throw new Error("Video runtime requires a local path");
  }
}

function parseVersion(output: string): string | null {
  const version = /\bversion\s+([^\s]+)/i.exec(output)?.[1];
  return version ? version.slice(0, 80).replace(/[^A-Za-z0-9._+-]/g, "_") : null;
}

let runtimeProbeCache: { expiresAt: number; value: VideoRuntimeStatus } | null = null;

export function resetVideoRuntimeProbeCacheForTests(): void {
  runtimeProbeCache = null;
}

export async function probeVideoRuntime(
  options: {
    cacheTtlMs?: number;
    runner?: VideoCommandRunner;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<VideoRuntimeStatus> {
  const now = Date.now();
  if (runtimeProbeCache && runtimeProbeCache.expiresAt > now) {
    return structuredClone(runtimeProbeCache.value);
  }

  const runner = options.runner ?? defaultRunner;
  const commandOptions = {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 5_000,
  };
  let value: VideoRuntimeStatus;
  try {
    const [ffmpeg, ffprobe] = await Promise.all([
      runner("ffmpeg", ["-version"], commandOptions),
      runner("ffprobe", ["-version"], commandOptions),
    ]);
    const ffmpegVersion = parseVersion(ffmpeg.stdout);
    const ffprobeVersion = parseVersion(ffprobe.stdout);
    value =
      ffmpegVersion && ffprobeVersion
        ? { available: true, ffmpegVersion, ffprobeVersion }
        : {
            available: false,
            ffmpegVersion,
            ffprobeVersion,
            reason: "FFmpeg and ffprobe versions could not be verified",
          };
  } catch {
    value = {
      available: false,
      ffmpegVersion: null,
      ffprobeVersion: null,
      reason: "FFmpeg and ffprobe are not available on PATH",
    };
  }

  runtimeProbeCache = {
    expiresAt: now + (options.cacheTtlMs ?? 30_000),
    value,
  };
  return structuredClone(value);
}

export function calculateFrameTimestamps(
  durationSeconds: number,
  requestedFrameCount: number
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Video duration must be positive");
  }
  if (
    !Number.isInteger(requestedFrameCount) ||
    requestedFrameCount < 1 ||
    requestedFrameCount > 16
  ) {
    throw new Error("Video frame count must be between 1 and 16");
  }
  const frameCount = Math.min(requestedFrameCount, Math.max(1, Math.floor(durationSeconds)));
  return Array.from(
    { length: frameCount },
    (_unused, index) => ((index + 0.5) * durationSeconds) / frameCount
  );
}

export async function probeLocalVideo(
  inputPath: string,
  options: {
    maxDurationSeconds?: number;
    runner?: VideoCommandRunner;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<{ durationSeconds: number }> {
  assertLocalPath(inputPath);
  const result = await (options.runner ?? defaultRunner)(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", inputPath],
    { signal: options.signal, timeoutMs: options.timeoutMs ?? 30_000 }
  );
  let durationSeconds = Number.NaN;
  try {
    const parsed = JSON.parse(result.stdout) as { format?: { duration?: unknown } };
    durationSeconds = Number(parsed.format?.duration);
  } catch {
    // The stable error below deliberately excludes raw ffprobe output.
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Video runtime returned invalid duration metadata");
  }
  if (durationSeconds > (options.maxDurationSeconds ?? 600)) {
    throw new Error("Video exceeds the maximum duration");
  }
  return { durationSeconds };
}

export async function extractFramesFromLocalVideo(
  inputPath: string,
  outputDirectory: string,
  options: {
    durationSeconds: number;
    frameCount: number;
    runner?: VideoCommandRunner;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<VideoFrameFile[]> {
  assertLocalPath(inputPath);
  assertLocalPath(outputDirectory);
  const timestamps = calculateFrameTimestamps(options.durationSeconds, options.frameCount);
  const runner = options.runner ?? defaultRunner;
  const frames: VideoFrameFile[] = [];

  for (let index = 0; index < timestamps.length; index++) {
    const timestampSeconds = timestamps[index];
    const outputPath = join(outputDirectory, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
    await runner(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        timestampSeconds.toFixed(3),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-y",
        outputPath,
      ],
      { signal: options.signal, timeoutMs: options.timeoutMs ?? 120_000 }
    );
    frames.push({ path: outputPath, timestampSeconds });
  }
  return frames;
}
