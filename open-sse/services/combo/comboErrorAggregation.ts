/**
 * Shared combo terminal-error aggregation.
 *
 * #10314 — combo error aggregation mixes quality and auth. Prior to this module
 * the combo terminal message was built as a single `lastError` string (last
 * writer wins — it can only ever represent ONE target's reason) concatenated
 * with a raw `[model (status)]` suffix. A quality-failure reason from one
 * target and a sibling's 401 were collapsed into one client-facing sentence
 * (`invalid_api_key [openai/proxy-account-b (401)]`) and a quality reason that
 * was not the final failing target was dropped entirely.
 *
 * This module gives each per-target failure a structured {model, status, error,
 * kind} entry, so the terminal message can list every distinct reason
 * separately (and classification-labelled) instead of mashing them, and it
 * redacts connection/account identifiers that, on openai-compatible proxy
 * connections, used to surface verbatim in client-visible and shared-warn
 * strings (ops/PII leak).
 */

export type ComboOutcomeKind =
  | "quality"
  | "auth"
  | "model"
  | "provider"
  | "timeout"
  | "skipped"
  | "upstream";

export interface ComboErrorEntry {
  model: string;
  status: number;
  error: string;
  kind: ComboOutcomeKind;
}

const KIND_LABELS: Record<ComboOutcomeKind, string> = {
  quality: "quality validation",
  auth: "auth",
  model: "model",
  provider: "provider",
  timeout: "timeout",
  skipped: "skipped",
  upstream: "upstream",
};

/**
 * Classify a single target's terminal outcome for the client-facing message.
 * Auth-class errors (401/403 or auth-sounding text) are kept distinct from
 * model-class (400/422) and provider-class (5xx) so a sibling's 401 is never
 * presented as "quality failed". Fall through to `model` for everything else.
 */
export function classifyComboOutcome(status: number, errorText: string): ComboOutcomeKind {
  const text = typeof errorText === "string" ? errorText : "";
  if (
    status === 401 ||
    status === 403 ||
    /(invalid.?api.?key|unauthorized|not.?authorized|auth(entication|orization)?)/i.test(text)
  ) {
    return "auth";
  }
  if (status === 408 || status >= 499) return "timeout";
  if (status >= 500) return "provider";
  return "model";
}

/**
 * Redact connection/account identifiers that can ride inside a proxy target's
 * model string (openai-compatible proxy model names often carry a connection
 * label). UUIDs and long hex hashes are truncated to a short `conn:` prefix.
 * Provider/model names operators need for debugging are left intact.
 */
export function redactConnectionLabel(modelStr: string | null | undefined): string {
  const label = typeof modelStr === "string" && modelStr ? modelStr : "unknown";
  return label
    .replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      (m) => `conn:${m.slice(0, 8)}`
    )
    .replace(/\b[0-9a-fA-F]{16,}\b/g, (m) => `conn:${m.slice(0, 8)}`);
}

/** Build the redacted, collision-free `model (status)` summary used by the
 *  global-combo-timeout diagnostics path. */
export function buildRedactedSummary(
  entries: Array<{ model: string; status: number }> | ReadonlyArray<{ model: string; status: number }>
): string {
  const slice = entries.slice(0, 5);
  const parts = slice.map((e) => `${redactConnectionLabel(e.model)} (${e.status})`).join(", ");
  return entries.length > 5 ? `${parts}... (+${entries.length - 5})` : parts;
}

/**
 * Format per-target terminal outcomes into one client-facing sentence that keeps
 * every distinct reason separate (and classification-labelled) instead of
 * mashing a single `lastError` with raw status markers. Always redacts
 * connection identifiers unless `{ redact: false }` is explicitly passed.
 */
export function formatComboOutcomes(
  entries: ReadonlyArray<{ model: string; status: number; error: string; kind?: ComboOutcomeKind }>,
  opts?: { redact?: boolean }
): string {
  if (!entries.length) return "";
  const redact = opts?.redact !== false;
  const slice = entries.slice(0, 5);
  const parts = slice.map((e) => {
    const label = redact ? redactConnectionLabel(e.model) : e.model;
    const kind = e.kind ? KIND_LABELS[e.kind] ?? e.kind : null;
    const reason = e.error || `HTTP ${e.status}`;
    const statusTxt = ` (HTTP ${e.status})`;
    return kind ? `${label}: ${kind} — ${reason}${statusTxt}` : `${label}: ${reason}${statusTxt}`;
  });
  return entries.length > 5
    ? `${parts.join("; ")}... (+${entries.length - 5} more)`
    : parts.join("; ");
}