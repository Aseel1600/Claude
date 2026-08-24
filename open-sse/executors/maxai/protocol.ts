/**
 * MaxAI web-app protocol — request bodies, header assembly, and OpenAI→MaxAI
 * context flattening. Ported from the MaxAI v3 Python client (chat/request.py,
 * translation/openai_in.py, translation/turn_render.py) and live-verified against
 * the real `/gpt/cwc/chat` endpoint.
 *
 * MaxAI is a stateless-full-history provider on the OmniRoute side: we send the
 * ENTIRE flattened transcript in `message_content[0].text` every turn, always
 * with `chat_history: []`, and mint a fresh `conversation_id` per request. The
 * live probe proved a bare `/gpt/cwc/chat` (no upsert/add_messages bookkeeping)
 * honors `model_name` and serves the real paid model, so no bookkeeping is sent.
 */
import { randomUUID } from "node:crypto";
import { MAXAI_APP_VERSION } from "./signing.ts";

export const MAXAI_BASE_URL = "https://api.maxai.me";
export const MAXAI_CHAT_PATH = "/gpt/cwc/chat";
export const MAXAI_MODELS_CONFIG_PATH = "/models/get_config";

/** Static Firefox-150 identity headers sent on every MaxAI request. */
export function maxaiStaticHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
    Accept: "*/*",
    "Accept-Language": "en-CA,en;q=0.9",
    Origin: "https://www.maxai.co",
    Referer: "https://www.maxai.co/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Content-Type": "application/json",
  };
}

// ── Chat body ───────────────────────────────────────────────────────────────
// Field ORDER is pinned (it is part of the HTTP/2 request fingerprint).
const CHAT_FIELD_ORDER = [
  "chat_mode",
  "conversation_id",
  "chat_history",
  "message_content",
  "chrome_extension_version",
  "model_name",
  "prompt_id",
  "prompt_name",
  "prompt_inputs",
  "doc_list",
  "event_source",
  "streaming",
  "prompt_type",
  "feature_name",
  "source_type",
  "platform_feature",
] as const;

export function newConversationId(): string {
  return randomUUID();
}

export function buildMaxaiChatBody(opts: {
  conversationId: string;
  text: string;
  modelName: string;
  language?: string;
  relatedQuestionCnt?: string;
}): Record<string, unknown> {
  const values: Record<string, unknown> = {
    chat_mode: "pro_chat",
    conversation_id: opts.conversationId,
    chat_history: [],
    message_content: [{ type: "text", text: opts.text }],
    chrome_extension_version: MAXAI_APP_VERSION,
    model_name: opts.modelName,
    prompt_id: "chat",
    prompt_name: "chat",
    prompt_inputs: {
      RELATED_QUESTION_CNT: opts.relatedQuestionCnt ?? "5",
      AI_RESPONSE_LANGUAGE: opts.language ?? "English",
    },
    doc_list: [],
    event_source: "web",
    streaming: true,
    prompt_type: "freestyle",
    feature_name: "immersive_chat",
    source_type: "NA",
    platform_feature: "web_app",
  };
  const ordered: Record<string, unknown> = {};
  for (const k of CHAT_FIELD_ORDER) ordered[k] = values[k];
  return ordered;
}

// ── OpenAI messages[] → MaxAI single text block ──────────────────────────────
interface OpenAiMessage {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

const ROLE_LABEL: Record<string, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
};
const HISTORY_HEADER = "=== Conversation so far (for context) ===";
const CURRENT_HEADER = "=== Current request (respond to THIS) ===";

/** Flatten OpenAI `content` (string or multipart array) to text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && (part as { type?: string }).type === "text"
          ? String((part as { text?: unknown }).text ?? "")
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Render OpenAI tool_calls[] as the prompted `<tool_call>` text MaxAI understands. */
function toolCallsToText(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls)) return "";
  const blocks: string[] = [];
  for (const call of toolCalls) {
    const fn = (call as { function?: { name?: unknown; arguments?: unknown } })?.function;
    if (!fn) continue;
    const name = typeof fn.name === "string" ? fn.name : "";
    let args = fn.arguments;
    if (typeof args !== "string") {
      try {
        args = JSON.stringify(args ?? {});
      } catch {
        args = "{}";
      }
    }
    blocks.push(`<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`);
  }
  return blocks.join("\n");
}

/** Render one non-system turn as a labeled block, or null to skip. */
function renderTurn(message: OpenAiMessage): string | null {
  const role = message.role;
  const text = contentToText(message.content).trim();
  if (role === "tool") {
    const id = message.tool_call_id ? ` tool_call_id="${message.tool_call_id}"` : "";
    return `<tool_response${id}>\n${text}\n</tool_response>`;
  }
  if (role === "assistant" && message.tool_calls) {
    const calls = toolCallsToText(message.tool_calls);
    const body = text ? `${text}\n${calls}`.trim() : calls;
    return `Assistant: ${body}`;
  }
  if (!text) return null;
  const label = ROLE_LABEL[role ?? "user"] ?? "User";
  return `${label}: ${text}`;
}

/**
 * Assemble the full structured context into one text block: system text leads,
 * prior turns render as a labeled transcript, and the LAST user turn is fenced
 * under a CURRENT header so a weak model answers THIS turn. Mirrors MaxAI v3
 * translation/openai_in.py::assemble_context.
 */
export function assembleMaxaiContext(messages: OpenAiMessage[]): string {
  // Find the last user turn (the current request).
  let curIdx = -1;
  let current = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      curIdx = i;
      current = contentToText(messages[i].content).trim();
      break;
    }
  }
  const systemParts: string[] = [];
  const historyParts: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === curIdx) continue;
    const m = messages[i];
    if (m?.role === "system") {
      const t = contentToText(m.content).trim();
      if (t) systemParts.push(t);
      continue;
    }
    const block = renderTurn(m);
    if (block) historyParts.push(block);
  }
  const out: string[] = [...systemParts];
  if (historyParts.length && current) {
    out.push(HISTORY_HEADER + "\n\n" + historyParts.join("\n\n"));
  } else {
    out.push(...historyParts);
  }
  if (current) {
    const head = historyParts.length ? `${CURRENT_HEADER}\n\n` : "";
    out.push(head + current);
  }
  if (out.length === 0) throw new Error("no content to send to MaxAI");
  return out.join("\n\n");
}
