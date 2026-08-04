/**
 * chat.z.ai SSE pre-read.
 *
 * The upstream answers HTTP 200 and only then reports failures inside the
 * stream, so the error must be detected before the executor commits to
 * returning a streaming Response. This reads just far enough to see whether the
 * first meaningful frame is an error, then hands back a stream that replays the
 * bytes already consumed.
 */
import { detectZaiUpstreamError, type ZaiUpstreamError } from "./errors.ts";

/** Stop pre-reading once past this — errors always arrive in the first frame. */
const MAX_PEEK_BYTES = 64 * 1024;

export type PeekResult =
  { error: ZaiUpstreamError } | { body: ReadableStream<Uint8Array>; text: string };

function replayStream(
  buffered: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = buffered.shift();
      if (next) {
        controller.enqueue(next);
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Scan complete `data:` lines for an error envelope or any real content. */
function scanPeeked(text: string): { error?: ZaiUpstreamError; sawContent: boolean } {
  const lines = text.split("\n");
  // Drop a trailing partial line — it may be truncated mid-JSON.
  lines.pop();
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const error = detectZaiUpstreamError(parsed);
    if (error) return { error, sawContent: false };
    return { sawContent: true };
  }
  return { sawContent: false };
}

export async function peekZaiStream(source: ReadableStream<Uint8Array>): Promise<PeekResult> {
  const reader = source.getReader();
  const buffered: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;

  while (bytes < MAX_PEEK_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered.push(value);
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    const scan = scanPeeked(text);
    if (scan.error) {
      await reader.cancel().catch(() => {});
      return { error: scan.error };
    }
    if (scan.sawContent) break;
  }

  return { body: replayStream(buffered, reader), text };
}
