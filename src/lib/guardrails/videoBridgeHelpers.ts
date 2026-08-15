import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectMediaParts, type MediaPart } from "@omniroute/open-sse/utils/mediaParts";

import { fetchRemoteMedia, type RemoteMediaFetchResult } from "@/shared/network/remoteImageFetch";

import {
  extractFramesFromLocalVideo,
  probeLocalVideo,
  type VideoCommandRunner,
} from "./videoBridgeRuntime";

export const VIDEO_BRIDGE_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_BRIDGE_MAX_DURATION_SECONDS = 600;

type VideoContainer = "messages" | "input";
type VideoMessage = { role?: string; content?: unknown };
type VideoRequestBody = {
  messages?: VideoMessage[];
  input?: VideoMessage[];
  [key: string]: unknown;
};

export interface VideoPart {
  container: VideoContainer;
  messageIndex: number;
  partIndex: number;
  ref: string;
  shape: "input_video" | "video_url" | "video_source" | "data_uri_string";
}

const REPLACEABLE_VIDEO_SHAPES: ReadonlySet<MediaPart["shape"]> = new Set([
  "input_video",
  "video_url",
  "video_source",
  "data_uri_string",
]);

export function extractVideoParts(body: VideoRequestBody): VideoPart[] {
  const container: VideoContainer | null = Array.isArray(body.messages)
    ? "messages"
    : Array.isArray(body.input)
      ? "input"
      : null;
  if (!container) return [];
  return detectMediaParts(body[container])
    .filter(
      (part) =>
        part.kind === "video" &&
        !part.nested &&
        part.ref.length > 0 &&
        REPLACEABLE_VIDEO_SHAPES.has(part.shape)
    )
    .map((part) => ({
      container,
      messageIndex: part.messageIndex,
      partIndex: part.partIndex,
      ref: part.ref,
      shape: part.shape as VideoPart["shape"],
    }));
}

export function replaceVideoParts<TBody extends VideoRequestBody>(
  body: TBody,
  parts: readonly VideoPart[],
  descriptions: readonly (string | null)[]
): TBody {
  const result = structuredClone(body);
  for (let index = 0; index < parts.length && index < descriptions.length; index++) {
    const description = descriptions[index];
    if (description === null) continue;
    const part = parts[index];
    const content = result[part.container]?.[part.messageIndex]?.content;
    if (!Array.isArray(content) || part.partIndex >= content.length) continue;
    content[part.partIndex] = {
      type: part.container === "input" ? "input_text" : "text",
      text: description,
    };
  }
  return result;
}

export interface DescribeVideoOptions {
  frameCount: number;
  maxBytes?: number;
  maxDurationSeconds?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface DescribeVideoDependencies {
  fetchRemote?: (url: string, options: { signal: AbortSignal }) => Promise<RemoteMediaFetchResult>;
  runner?: VideoCommandRunner;
}

export interface DescribedVideo {
  cacheHits?: number;
  description: string;
  durationSeconds: number;
  framesRequested: number;
  framesUsed: number;
}

function decodeVideoDataUri(ref: string): Buffer | null {
  const match = /^data:video\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(ref);
  return match ? Buffer.from(match[1].replace(/\s/g, ""), "base64") : null;
}

async function loadVideoBytes(
  part: VideoPart,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal,
  deps: DescribeVideoDependencies
): Promise<Buffer> {
  const dataBytes = decodeVideoDataUri(part.ref);
  let bytes: Buffer;
  if (dataBytes) {
    bytes = dataBytes;
  } else {
    if (!part.ref.startsWith("https://")) {
      throw new Error("Video Bridge accepts only HTTPS URLs or video data URIs");
    }
    const fetchRemote =
      deps.fetchRemote ??
      ((url: string, options: { signal: AbortSignal }) =>
        fetchRemoteMedia(url, {
          guard: "public-only",
          maxBytes,
          pinDns: true,
          signal: options.signal,
          timeoutMs,
        }));
    bytes = (await fetchRemote(part.ref, { signal })).buffer;
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error("Video exceeds the maximum size");
  }
  return bytes;
}

export function formatVideoTimestamp(timestampSeconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(timestampSeconds * 1000));
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export async function describeVideoPart(
  part: VideoPart,
  options: DescribeVideoOptions,
  captionFrame: (
    frameDataUri: string,
    timestampSeconds: number,
    signal: AbortSignal
  ) => Promise<string>,
  deps: DescribeVideoDependencies = {}
): Promise<DescribedVideo> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "omniroute-video-bridge-"));
  try {
    const bytes = await loadVideoBytes(
      part,
      options.maxBytes ?? VIDEO_BRIDGE_MAX_BYTES,
      options.timeoutMs,
      signal,
      deps
    );
    const inputPath = join(temporaryDirectory, "input.video");
    const framesDirectory = join(temporaryDirectory, "frames");
    await mkdir(framesDirectory, { mode: 0o700 });
    await writeFile(inputPath, bytes, { mode: 0o600 });

    const metadata = await probeLocalVideo(inputPath, {
      maxDurationSeconds: options.maxDurationSeconds ?? VIDEO_BRIDGE_MAX_DURATION_SECONDS,
      runner: deps.runner,
      signal,
      timeoutMs: Math.min(options.timeoutMs, 30_000),
    });
    const frames = await extractFramesFromLocalVideo(inputPath, framesDirectory, {
      durationSeconds: metadata.durationSeconds,
      frameCount: options.frameCount,
      runner: deps.runner,
      signal,
      timeoutMs: options.timeoutMs,
    });

    const descriptions: string[] = [];
    for (const frame of frames) {
      try {
        const jpeg = await readFile(frame.path);
        const caption = (
          await captionFrame(
            `data:image/jpeg;base64,${jpeg.toString("base64")}`,
            frame.timestampSeconds,
            signal
          )
        ).trim();
        if (caption) {
          descriptions.push(`frame@t=${formatVideoTimestamp(frame.timestampSeconds)} ${caption}`);
        }
      } catch {
        if (signal.aborted) {
          throw new Error("Video Bridge processing timed out or was aborted");
        }
        // Partial frame failures are omitted. An all-frame failure is handled below.
      }
    }
    if (descriptions.length === 0) {
      throw new Error("Video frames could not be described");
    }
    return {
      description: `[Video description: ${descriptions.join("; ")}]`,
      durationSeconds: metadata.durationSeconds,
      framesRequested: frames.length,
      framesUsed: descriptions.length,
    };
  } catch (error) {
    if (signal.aborted) throw new Error("Video Bridge processing timed out or was aborted");
    throw error;
  } finally {
    clearTimeout(timeout);
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
