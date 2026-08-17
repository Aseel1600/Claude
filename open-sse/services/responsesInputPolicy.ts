import { REGISTRY } from "../config/providerRegistry.ts";
import type { ResponsesReasoningTransport } from "../config/providerRegistry.ts";

type JsonRecord = Record<string, unknown>;

const REASONING_TRANSPORTS = new Map<string, ResponsesReasoningTransport>();
for (const [id, entry] of Object.entries(REGISTRY)) {
  if (!entry.responsesReasoningTransport) continue;
  REASONING_TRANSPORTS.set(id.toLowerCase(), entry.responsesReasoningTransport);
  if (entry.alias) {
    REASONING_TRANSPORTS.set(entry.alias.toLowerCase(), entry.responsesReasoningTransport);
  }
}

export interface ResponsesInputPolicyOptions {
  provider?: string | null;
  preserveEncryptedReasoning?: boolean;
  onIncompatibleReasoning?: "reject" | "drop";
}

export interface ResponsesInputPolicyResult {
  incompatibleReasoning: boolean;
}

export function resolveResponsesReasoningTransport(
  provider: string | null | undefined,
  preserveEncryptedReasoning = false
): ResponsesReasoningTransport | null {
  const normalized = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  const transport = REASONING_TRANSPORTS.get(normalized);
  return transport ?? (preserveEncryptedReasoning ? "opaque" : null);
}

export function createReasoningTransportIncompatibleError(): Error & {
  statusCode: number;
  errorType: string;
} {
  const error = new Error(
    "Reasoning continuation is not compatible with the selected target"
  ) as Error & { statusCode: number; errorType: string };
  error.statusCode = 400;
  error.errorType = "reasoning_transport_incompatible";
  return error;
}

function hasPlaintextReasoning(record: JsonRecord): boolean {
  return (
    Array.isArray(record.content) &&
    record.content.some((part) => {
      const value =
        part && typeof part === "object" && !Array.isArray(part) ? (part as JsonRecord) : null;
      return (
        value?.type === "reasoning_text" &&
        typeof value.text === "string" &&
        value.text.trim().length > 0
      );
    })
  );
}

export function hasOpaqueReasoningState(record: JsonRecord): boolean {
  return (
    (typeof record.encrypted_content === "string" && record.encrypted_content.trim().length > 0) ||
    record.signature !== undefined ||
    record.format !== undefined
  );
}

function isIncompatibleReasoningRecord(
  record: JsonRecord,
  transport: ResponsesReasoningTransport | null
): boolean {
  if (record.type !== "reasoning") return false;
  const plaintext = hasPlaintextReasoning(record);
  const opaque = hasOpaqueReasoningState(record);
  if (!plaintext && !opaque) return false;
  return !(
    (transport === "plaintext" && plaintext && !opaque) ||
    (transport === "opaque" && opaque && !plaintext)
  );
}

/**
 * Removes Responses state that is not portable to the selected upstream.
 * Plaintext reasoning and provider-generated opaque reasoning are separate
 * transports; unknown targets receive neither. The optional drop action removes
 * all reasoning when any active item is incompatible. Retained items are cloned
 * so Combo attempts cannot mutate each other's fallback input.
 */
export function applyResponsesInputPolicy(
  body: Record<string, unknown>,
  options: ResponsesInputPolicyOptions = {}
): ResponsesInputPolicyResult {
  if (Array.isArray(body.input) && body.input.length === 0) {
    body.input = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "continue" }],
      },
    ];
  }

  if (!Array.isArray(body.input)) return { incompatibleReasoning: false };

  const transport = resolveResponsesReasoningTransport(
    options.provider,
    options.preserveEncryptedReasoning
  );
  const dropAllReasoning =
    options.onIncompatibleReasoning === "drop" &&
    body.input.some((item) => {
      const record =
        item && typeof item === "object" && !Array.isArray(item) ? (item as JsonRecord) : null;
      return record ? isIncompatibleReasoningRecord(record, transport) : false;
    });
  let incompatibleReasoning = false;
  const filtered: unknown[] = [];

  for (const item of body.input) {
    // Array-form Responses input contains item objects. Bare strings are stored
    // provider references and are not portable across concrete targets.
    if (typeof item === "string") {
      continue;
    }

    const record =
      item && typeof item === "object" && !Array.isArray(item) ? (item as JsonRecord) : null;
    if (!record) {
      filtered.push(item);
      continue;
    }

    if (record.type === "item_reference") {
      continue;
    }

    if (record.type === "reasoning") {
      if (dropAllReasoning) continue;
      const plaintext = hasPlaintextReasoning(record);
      const opaque = hasOpaqueReasoningState(record);
      if (plaintext || opaque) {
        const compatible =
          (transport === "plaintext" && plaintext && !opaque) ||
          (transport === "opaque" && opaque && !plaintext);
        if (!compatible) {
          incompatibleReasoning = true;
          continue;
        }
        if (transport === "opaque") {
          filtered.push({ ...record });
          continue;
        }
      } else {
        continue;
      }
    }

    const cloned = { ...record };
    if (typeof cloned.id === "string") {
      delete cloned.id;
    }
    filtered.push(cloned);
  }

  body.input = filtered;
  return { incompatibleReasoning };
}
