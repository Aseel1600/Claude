/**
 * Upstream 400 classification for combo fallback (extracted from combo.ts).
 *
 * These three predicates decide whether a 400 should ADVANCE the combo to the next target or
 * hard-stop it. They are pure classifiers over the upstream error text and share the canonical
 * pattern lists in accountFallback.ts, so they do not belong inside the routing loop.
 *
 * combo.ts re-exports them, so the public surface is unchanged (combo-param-validation-fallback-4519
 * imports them from combo.ts). Behavior-preserving move — bodies are identical to the originals.
 */
import { CONTEXT_OVERFLOW_PATTERNS, MODEL_ACCESS_DENIED_PATTERNS } from "../accountFallback.ts";

/** @param {string} errorText */
export function isContextOverflow400(errorText) {
  return (
    /\bcontext.*(?:length_exceeded|too long|overflow|exceeded|window|limit)\b/i.test(errorText) ||
    /exceeds.*context/i.test(errorText) ||
    /your input exceeds/i.test(errorText) ||
    // Reuse accountFallback.ts's CONTEXT_OVERFLOW_PATTERNS (single source of truth)
    // so wording like Kimi's "exceeded model token limit" — which never says the
    // literal word "context" — is still recognized as an overflow/fallback-worthy
    // 400 instead of halting the whole combo (issue #6637).
    CONTEXT_OVERFLOW_PATTERNS.some((p) => p.test(errorText))
  );
}
/** @param {string} errorText */
export function isParamValidation400(errorText) {
  return (
    /\bmax_tokens\b.*(?:illegal|must|range|invalid)/i.test(errorText) ||
    /\bparameter is illegal\b/i.test(errorText) ||
    /\bis illegal.*range\b/i.test(errorText)
  );
}
/**
 * #5249 / #2101: model-scoped 400s must NEVER stop the combo.
 * Upstream often wraps "model X is not supported" in `invalid_request_error` /
 * "Bad Request" envelopes. Those wrapper words match the body-specific stop
 * substrings, so without this exemption the combo hard-stops on the first
 * unavailable model instead of trying the next target. Keep the models in the
 * combo — if one rejects, advance.
 * @param {string} errorText
 */
export function isModelScoped400(errorText) {
  const text = String(errorText || "");
  if (!text) return false;
  if (MODEL_ACCESS_DENIED_PATTERNS.some((p) => p.test(text))) return true;
  // Extra model-rejection shapes that providers emit outside the shared list
  // (Responses API, Copilot, gateway wrappers).
  return (
    /\bmodel\b[\s\S]{0,80}?\b(?:not\s+supported|unsupported|unknown|unavailable)\b/i.test(text) ||
    /\b(?:not\s+supported|unsupported|unknown)\b[\s\S]{0,80}?\bmodel\b/i.test(text) ||
    /\bunsupported_api_for_model\b/i.test(text) ||
    /\bdoes\s+not\s+support\s+(?:the\s+)?responses\s+api\b/i.test(text)
  );
}
