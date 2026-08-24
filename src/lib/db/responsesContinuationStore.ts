/**
 * responsesContinuationStore.ts — OmniRoute-native `previous_response_id`
 * virtualization for the OpenAI Responses API.
 *
 * Exposes `previous_response_id` continuation when a retained Responses
 * artifact still has the expected top-level input/output array shapes,
 * regardless of whether the actual upstream provider supports Responses-API
 * state. OmniRoute resolves the response id back to that retained state and
 * appends the new delta before forwarding upstream. Privacy-redacted
 * Video Bridge artifacts deliberately fail closed; those clients must resend
 * full history instead of relying on an incomplete server-side replay.
 *
 * Storage: reuses the existing bounded, privacy-filtered call-log pipeline
 * artifact instead of duplicating conversation content into a second store.
 * Lookup validates the retained provider-input and client-output array shapes
 * and explicitly rejects trusted Video-transcript redaction. Other generic
 * bounded-log truncation markers are not exhaustively classified here. Only a
 * lightweight `call_logs.response_id` index
 * (154_call_logs_response_id.sql) is new. Every lookup is scoped by
 * `api_key_id` -- one client can never resolve another client's stored
 * conversation.
 */

import { getDbInstance } from "./core";
import { VIDEO_TRANSCRIPT_REDACTION_PIPELINE_KEY } from "../guardrails/videoTranscriptLogRedaction";
import { readCallArtifact } from "../usage/callLogArtifacts";

export type ResponsesContinuationState = {
  input: unknown[];
  output: unknown[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Both array-bounding implementations that clip a stored artifact's payload
// for log-storage size (cloneBoundedChatLogPayload in
// open-sse/handlers/chatCore/logTruncation.ts, and cloneBoundedForLog in
// open-sse/utils/requestLogger.ts) prepend this sentinel in place of the
// items they dropped once an array exceeds their tail-item cap -- so a real,
// ordinary-length conversation resolves fine, but any conversation whose
// input/output grew past that cap gets this object silently standing in for
// real history. Reading it back as a genuine Responses-API item sent a
// malformed reconstructed request upstream (translator 400:
// "input item type 'missing' cannot be represented..."), which is worse than
// the plain cache-miss this function is otherwise designed to fail into.
const TRUNCATED_ARRAY_MARKER = "_omniroute_truncated_array";

function containsTruncatedArrayMarker(items: readonly unknown[]): boolean {
  return items.some((item) => isPlainRecord(item) && item[TRUNCATED_ARRAY_MARKER] === true);
}

/**
 * Resolve the retained input + output from a prior Responses API call, so
 * the caller can reconstruct `next_input = stored.input + stored.output +
 * new_delta`. Returns null on any lookup/read/shape failure (unknown id,
 * wrong tenant, artifact missing, invalid top-level replay shapes, or trusted
 * Video-transcript redaction) so the caller can ask the client to resend full
 * history. Video transcript redaction is identified by a trusted pipeline-level
 * flag written by the server, never by caller-controlled prose. Generic nested
 * bounded-log truncation remains an inherited limitation of this shared store.
 */
export function resolvePreviousResponseState(
  responseId: string,
  apiKeyId: string | null | undefined
): ResponsesContinuationState | null {
  if (!responseId) return null;

  const db = getDbInstance();
  const row = db
    .prepare(
      `SELECT artifact_relpath, api_key_id FROM call_logs
       WHERE response_id = ? AND detail_state = 'ready'
       ORDER BY timestamp DESC LIMIT 1`
    )
    .get(responseId) as { artifact_relpath: string | null; api_key_id: string | null } | undefined;

  if (!row || !row.artifact_relpath) return null;
  // Tenant isolation: a response id is only ever handed back to the API key
  // that created it. A stored row with no api_key_id at all (no-log/legacy)
  // can never be resolved by any key -- fail closed rather than guess.
  if (!apiKeyId || row.api_key_id !== apiKeyId) return null;

  const { artifact, state } = readCallArtifact(row.artifact_relpath);
  if (state !== "ready" || !artifact?.pipeline) return null;

  const clientRawRequest = artifact.pipeline.clientRawRequest as { body?: unknown } | undefined;
  const clientResponse = artifact.pipeline.clientResponse as
    { output?: unknown; summary?: { output?: unknown } } | undefined;

  // clientRawRequest, not providerRequest: this store only ever fires for
  // sourceFormat === OPENAI_RESPONSES (see chat.ts), so the client's own
  // request is always Responses-API shaped and always carries `input`.
  // providerRequest is upstream-shaped and only has `input` for a native
  // passthrough Responses API upstream -- any translated upstream (e.g. Chat
  // Completions `messages`) rewrites the wire body entirely, which made this
  // unconditionally unresolvable for every translate-mode/auto-routed
  // connection (previous_response_not_found on every attempt, regardless of
  // whether the id was real and the artifact was otherwise 'ready').
  const input = isPlainRecord(clientRawRequest?.body) ? clientRawRequest.body.input : undefined;
  // A streaming clientResponse is clientPayloadCollector.build()'s output, which
  // always nests the caller's summary under `.summary` (see
  // createStructuredSSECollector in streamPayloadCollector.ts) -- a non-streaming
  // one carries `output` directly. Same dual-shape concern as extractResponsesId
  // in open-sse/handlers/chatCore/attemptLogging.ts, checked here independently
  // since this reads back a stored artifact rather than the live object.
  const output = Array.isArray(clientResponse?.output)
    ? clientResponse.output
    : clientResponse?.summary?.output;
  if (
    artifact.pipeline[VIDEO_TRANSCRIPT_REDACTION_PIPELINE_KEY] === true ||
    !Array.isArray(input) ||
    !Array.isArray(output)
  ) {
    return null;
  }
  if (containsTruncatedArrayMarker(input) || containsTruncatedArrayMarker(output)) return null;

  return { input, output };
}
