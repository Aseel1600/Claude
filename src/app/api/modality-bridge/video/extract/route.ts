import { createErrorResponse } from "@/lib/api/errorResponse";
import {
  VIDEO_BRIDGE_BROKER_PATH,
  isVideoBridgeBrokerInternalRequest,
} from "@/lib/guardrails/videoBridgeBrokerAuth";
import { createVideoExtractionQueue } from "@/lib/guardrails/videoBridgeBrokerQueue";
import { extractVideoFramesFromBytes } from "@/lib/guardrails/videoBridgeRuntime";
import { resolveModelSyncInternalBaseUrl } from "@/shared/services/modelSyncScheduler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_DURATION_SECONDS = 600;
const BROKER_TIMEOUT_MS = 120_000;
const extractionQueue = createVideoExtractionQueue({
  concurrency: 1,
  maxPending: 4,
  maxQueuedBytes: 100 * 1024 * 1024,
});

function invalid(message: string, status = 400): Response {
  return createErrorResponse({ status, message, type: "invalid_request" });
}

function parseFrameCount(url: URL): number | null {
  if ([...url.searchParams.keys()].some((key) => key !== "frames")) return null;
  const raw = url.searchParams.get("frames");
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 16 ? value : null;
}

function expectedBrokerPath(): string {
  const basePath = new URL(resolveModelSyncInternalBaseUrl()).pathname.replace(/\/$/, "");
  return `${basePath}${VIDEO_BRIDGE_BROKER_PATH}`;
}

export async function readBoundedVideoBrokerBody(
  request: Request,
  maxBytes = MAX_INPUT_BYTES
): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel("Video Bridge input exceeds the byte limit");
      throw new Error("VIDEO_INPUT_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    totalBytes
  );
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== expectedBrokerPath()) {
    return invalid("Invalid Video Bridge broker request", 404);
  }
  if (!isVideoBridgeBrokerInternalRequest(request, VIDEO_BRIDGE_BROKER_PATH)) {
    return invalid("This endpoint requires an authenticated internal loopback request", 403);
  }
  if (request.headers.get("content-type")?.toLowerCase() !== "application/octet-stream") {
    return invalid("Video Bridge broker requires application/octet-stream");
  }
  const frameCount = parseFrameCount(url);
  if (!frameCount) return invalid("Video Bridge frame count must be between 1 and 16");
  const declaredHeader = request.headers.get("content-length");
  const declaredLength = declaredHeader === null ? null : Number(declaredHeader);
  if (
    declaredLength !== null &&
    (!Number.isFinite(declaredLength) || declaredLength < 1 || declaredLength > MAX_INPUT_BYTES)
  ) {
    await request.body?.cancel("Video Bridge input exceeds the byte limit");
    return invalid("Video Bridge input exceeds the byte limit", 413);
  }

  let bytes: Buffer;
  try {
    bytes = await readBoundedVideoBrokerBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "VIDEO_INPUT_TOO_LARGE") {
      return invalid("Video Bridge input exceeds the byte limit", 413);
    }
    return invalid("Video Bridge input could not be read");
  }
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_INPUT_BYTES ||
    (declaredLength !== null && bytes.byteLength !== declaredLength)
  ) {
    return invalid("Video Bridge input exceeds the byte limit", 413);
  }

  const deadline = AbortSignal.timeout(BROKER_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, deadline]);
  try {
    const result = await extractionQueue.run(
      bytes.byteLength,
      () =>
        extractVideoFramesFromBytes(bytes, {
          frameCount,
          maxDurationSeconds: MAX_DURATION_SECONDS,
          signal,
          timeoutMs: BROKER_TIMEOUT_MS,
        }),
      signal
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unavailable =
      error && typeof error === "object" && "code" in error && error.code === "ENOENT";
    console.warn("[VideoBridgeBroker] extraction failed", {
      aborted: signal.aborted,
      code: unavailable ? "RUNTIME_UNAVAILABLE" : "EXTRACTION_FAILED",
      frameCount,
      inputBytes: bytes.byteLength,
    });
    if (signal.aborted) return invalid("Video extraction was aborted", 499);
    if (unavailable) return invalid("Video extraction runtime is unavailable", 503);
    return invalid("Video extraction failed", 422);
  }
}
