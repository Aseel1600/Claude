/**
 * Runstead attempt-receipt v1 — strict producer for the protected ChatGPT Web lane.
 *
 * Contract: the Runstead client sends `X-Runstead-Attempt-Receipts: v1` plus a
 * non-empty `X-Runstead-Client-Request-Id` and an explicit
 * `X-OmniRoute-Connection` pin. OmniRoute answers with exactly one
 * `X-OmniRoute-Attempt-Receipts` header whose JSON body is a finalized v1
 * `AttemptReceiptSet` born at the physical model-send boundary (the single
 * CONV_URL POST inside ChatGptWebExecutor).
 *
 * The wire format is authoritative in Runstead:
 * `internal/provider/attempt_receipts.go` (schema/outcomes) and
 * `internal/provider/omniroute/client_transport.go` (header handling). This
 * module only produces that format; it never invents outcomes, never
 * amplifies attempts, and never exposes raw connection ids.
 *
 * Non-opt-in requests never touch this module's active path: parsing returns
 * `inactive` and every helper is only invoked from the strict lane.
 */
import { createHash, randomUUID } from "node:crypto";

export const RUNSTEAD_ATTEMPT_RECEIPTS_REQUEST_HEADER = "X-Runstead-Attempt-Receipts";
export const RUNSTEAD_CLIENT_REQUEST_ID_HEADER = "X-Runstead-Client-Request-Id";
export const OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER = "X-OmniRoute-Attempt-Receipts";
export const RUNSTEAD_ATTEMPT_RECEIPTS_VERSION = "v1";
export const RUNSTEAD_ATTEMPT_RECEIPTS_PROVIDER = "chatgpt-web";

/** Only the strict lane derives lane hashes; this salt scopes the derivation. */
const LANE_HASH_PREFIX = "omniroute-connection-v1";
const LANE_HASH_SEPARATOR = 0x00;

/** Outcome values allowed by the Runstead v1 schema (subset used by this lane). */
export type AttemptOutcome =
  | "success"
  | "error"
  | "http_error"
  | "transport_error"
  | "rate_or_capacity"
  | "authentication_expired"
  | "authentication_denied"
  | "http_403"
  | "login_challenge"
  | "captcha"
  | "suspicious_activity"
  | "account_warning"
  | "feature_restriction"
  | "connection_reset"
  | "timeout"
  | "empty_response"
  | "malformed_upstream_response"
  | "upstream_server_failure"
  | "cancelled"
  | "uncertain";

export interface RunsteadStrictContext {
  clientRequestId: string;
  pinnedConnectionId: string;
  /** Canonical provider-prefixed model the client requested, e.g. "chatgpt-web/gpt-5". */
  canonicalModel: string;
}

export type RunsteadStrictOptIn =
  | { kind: "inactive" }
  | { kind: "active"; context: RunsteadStrictContext }
  | { kind: "rejected"; status: number; message: string };

/**
 * Parse the Runstead receipt-v1 opt-in headers. The strict mode activates ONLY
 * for an exact `X-Runstead-Attempt-Receipts: v1` value; any other value (or its
 * absence) keeps OmniRoute's normal behavior byte-for-byte.
 *
 * Every `rejected` result fails closed BEFORE any model POST and carries no
 * receipt: Runstead treats a missing receipt set conservatively.
 */
export function parseRunsteadStrictOptIn(opts: {
  requestHeaders: Headers;
  body: Record<string, unknown> | null | undefined;
  modelStr: string | null | undefined;
}): RunsteadStrictOptIn {
  const version = opts.requestHeaders.get(RUNSTEAD_ATTEMPT_RECEIPTS_REQUEST_HEADER)?.trim();
  if (version !== RUNSTEAD_ATTEMPT_RECEIPTS_VERSION) {
    return { kind: "inactive" };
  }

  const clientRequestId = opts.requestHeaders.get(RUNSTEAD_CLIENT_REQUEST_ID_HEADER)?.trim() ?? "";
  if (!clientRequestId) {
    return {
      kind: "rejected",
      status: 400,
      message:
        "X-Runstead-Attempt-Receipts: v1 requires a non-empty X-Runstead-Client-Request-Id header",
    };
  }

  const pinnedConnectionId = opts.requestHeaders.get("x-omniroute-connection")?.trim() ?? "";
  if (!pinnedConnectionId) {
    return {
      kind: "rejected",
      status: 400,
      message: "X-Runstead-Attempt-Receipts: v1 requires an explicit X-OmniRoute-Connection pin",
    };
  }

  const modelStr = (opts.modelStr ?? "").trim();
  if (!modelStr.startsWith(`${RUNSTEAD_ATTEMPT_RECEIPTS_PROVIDER}/`)) {
    return {
      kind: "rejected",
      status: 400,
      message:
        "X-Runstead-Attempt-Receipts: v1 is only available for the chatgpt-web provider with an explicit chatgpt-web/<model>",
    };
  }

  const body = opts.body ?? {};
  if (body.stream === true) {
    return {
      kind: "rejected",
      status: 400,
      message: "X-Runstead-Attempt-Receipts: v1 is text-only and non-streaming (stream=false)",
    };
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    return {
      kind: "rejected",
      status: 400,
      message: "X-Runstead-Attempt-Receipts: v1 rejects tool calls (text-only)",
    };
  }

  return {
    kind: "active",
    context: { clientRequestId, pinnedConnectionId, canonicalModel: modelStr },
  };
}

/**
 * Derive the v1 account-lane hash from the REAL connection used by OmniRoute.
 *
 * SHA-256( UTF8("omniroute-connection-v1") || byte 0x00 || UTF8(connection_id) )
 * as lowercase hexadecimal (64 chars). Runstead #30 derives the same value over
 * the configured connection, so a receipt produced on a different connection
 * cannot validate.
 */
export function computeAccountLaneHash(connectionId: string): string {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(LANE_HASH_PREFIX);
  const separator = new Uint8Array([LANE_HASH_SEPARATOR]);
  const id = encoder.encode(connectionId);
  const input = new Uint8Array(prefix.length + separator.length + id.length);
  input.set(prefix, 0);
  input.set(separator, prefix.length);
  input.set(id, prefix.length + separator.length);
  return createHash("sha256").update(input).digest("hex");
}

/** Map an observed upstream HTTP status to the Runstead v1 outcome vocabulary. */
export function attemptOutcomeForHttpStatus(status: number): AttemptOutcome {
  if (status >= 200 && status < 300) return "success";
  if (status === 401) return "authentication_expired";
  if (status === 403) return "http_403";
  if (status === 429) return "rate_or_capacity";
  if (status >= 500) return "upstream_server_failure";
  return "http_error";
}

export interface RunsteadReceiptInput {
  clientRequestId: string;
  /** Canonical provider-prefixed model the client requested. */
  model: string;
  /** The REAL connection id the physical POST used (never exposed raw). */
  connectionId: string;
  outcome: AttemptOutcome;
  startedAt: Date;
  completedAt: Date;
  /** Fresh immutable attempt identifier; defaults to a UUIDv4. */
  attemptId?: string;
}

/**
 * Build the finalized v1 AttemptReceiptSet JSON for exactly one attempt.
 * Contains no cookies, tokens, prompts, response bodies or raw connection ids.
 */
export function buildRunsteadAttemptReceiptSet(input: RunsteadReceiptInput): string {
  const receipt = {
    schema_version: 1,
    attempt_id: input.attemptId ?? randomUUID(),
    client_request_id: input.clientRequestId,
    sequence: 1,
    provider: RUNSTEAD_ATTEMPT_RECEIPTS_PROVIDER,
    model: input.model,
    account_lane_hash: computeAccountLaneHash(input.connectionId),
    started_at: input.startedAt.toISOString(),
    completed_at: input.completedAt.toISOString(),
    outcome: input.outcome,
    trigger: "initial",
    upstream_reached: true,
  };
  const set = {
    schema_version: 1,
    client_request_id: input.clientRequestId,
    finalized: true,
    receipts: [receipt],
  };
  return JSON.stringify(set);
}

/**
 * Attach the receipt set to a Response as the only forwarded contract header.
 * This is the ONLY header this contract propagates; nothing else is passed
 * through from the executor or the upstream.
 */
export function withAttemptReceiptsHeader(response: Response, receiptSetJson: string): Response {
  const headers = new Headers(response.headers);
  headers.set(OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER, receiptSetJson);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** True when a Response carries a receipt set (used by the handler forwarder). */
export function getAttemptReceiptsHeader(response: Response): string | null {
  return response.headers.get(OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER);
}

/**
 * Structural fail-closed check for the strict lane, evaluated before any model
 * POST. Returns an error message (or null when the lane is provable):
 * - provider must be chatgpt-web;
 * - the model about to be executed must be exactly the requested canonical
 *   model (any reroute/alias/fallback breaks the contract);
 * - the connection that will execute must be exactly the pinned one.
 */
export function validateRunsteadStrictLane(args: {
  context: RunsteadStrictContext;
  provider: string;
  effectiveModel: string;
  selectedConnectionId: string | null | undefined;
}): string | null {
  if (args.provider !== RUNSTEAD_ATTEMPT_RECEIPTS_PROVIDER) {
    return "Runstead receipt-v1 is only available for the chatgpt-web provider";
  }
  if (`${args.provider}/${args.effectiveModel}` !== args.context.canonicalModel) {
    return "Runstead receipt-v1 requires the requested model to be preserved (no rerouting or fallback)";
  }
  if (args.selectedConnectionId !== args.context.pinnedConnectionId) {
    return "Runstead receipt-v1 requires the pinned connection to be the selected connection";
  }
  return null;
}
