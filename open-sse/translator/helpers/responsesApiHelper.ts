/**
 * Convert OpenAI Responses API format to standard chat completions format.
 * Delegates to the canonical translator to avoid logic duplication.
 */
import { requiresAuthenticReasoningContent } from "../../utils/reasoningContentInjector.ts";
import { openaiResponsesToOpenAIRequest } from "../request/openai-responses.ts";

export function convertResponsesApiFormat(
  body: Record<string, unknown>,
  credentials: unknown = null,
  provider: unknown = null,
  model: unknown = null
): Record<string, unknown> {
  const credentialRecord =
    credentials && typeof credentials === "object" && !Array.isArray(credentials)
      ? (credentials as Record<string, unknown>)
      : {};
  const translationCredentials = requiresAuthenticReasoningContent(provider, model)
    ? { ...credentialRecord, _preserveReasoningContent: true }
    : credentials;
  const converted = openaiResponsesToOpenAIRequest(provider, body, null, translationCredentials);
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    throw new TypeError("Responses request conversion must produce an object");
  }
  return converted as Record<string, unknown>;
}
