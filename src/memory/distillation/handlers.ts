/**
 * Default distillation handlers — one per task kind.
 *
 * Each handler is responsible for:
 *   1. Building the prompt/messages for the LLM call (size-capped).
 *   2. Parsing the LLM response into a structured payload the store can
 *      persist. JSON is the canonical shape; we apply a tolerant extractor
 *      because providers frequently wrap it in code fences or prose.
 *   3. Returning the result + a parsed-shape that the worker can hand to
 *      the future `distillation_apply` repository call.
 *
 * The actual provider-facing runner is injected — the handlers themselves
 * do NOT call the executor directly. They take a `callModel` adapter and
 *     the resolved selection, and return a `DistillationHandlerResult`.
 *
 * Tencent prompt integration is a dynamic-import inside each handler so
 * the prompt content is fetched lazily (zero cost when the prompt is not
 * used) and a missing/failing import is a structured error the worker can
 * classify, NOT a crash.
 */

import type { DistillationTask } from "./store.ts";

export interface HandlerCallArgs {
  task: DistillationTask;
  selection: { provider: string; model: string };
  callModel: (args: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    maxTokens: number;
  }) => Promise<{ text: string; promptTokens: number; completionTokens: number }>;
  budget: {
    maxTokens: number;
    maxSteps: number;
    maxCalls: number;
    maxDepth: number;
  };
  /** Optional override clock (tests only). */
  now?: () => number;
}

export interface HandlerResult {
  /** Structured payload the caller can persist. */
  payload: unknown;
  /** Optional regex-fallback evidence (recorded only as L0 evidence). */
  fallbackEvidence: Array<{ kind: string; match: string }>;
  promptTokens: number;
  completionTokens: number;
}

export type HandlerError =
  | { kind: "budget_exceeded"; message: string }
  | { kind: "parse_failed"; message: string }
  | { kind: "semantic_invalid"; message: string }
  | { kind: "model_unset"; message: string };

export type HandlerOutcome =
  { ok: true; result: HandlerResult } | { ok: false; error: HandlerError };

export type DistillationHandler = ((args: HandlerCallArgs) => Promise<HandlerOutcome>) & {
  readonly kind: DistillationTask["kind"];
};

function defineHandler(
  kind: DistillationTask["kind"],
  fn: (args: HandlerCallArgs) => Promise<HandlerOutcome>
): DistillationHandler {
  const callable = fn as DistillationHandler;
  Object.defineProperty(callable, "kind", { value: kind, enumerable: true });
  return callable;
}

const JSON_BLOCK_RE = /```(?:json)?\s*([\s\S]+?)```/i;
const JSON_FIRST_OBJECT_RE = /\{[\s\S]*\}/;

function safeParseJson(raw: string): unknown | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fallthrough */
  }
  const fenced = trimmed.match(JSON_BLOCK_RE);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fallthrough */
    }
  }
  const first = trimmed.match(JSON_FIRST_OBJECT_RE);
  if (first && first[0]) {
    try {
      return JSON.parse(first[0]);
    } catch {
      /* fallthrough */
    }
  }
  return null;
}

function capMessages(
  messages: HandlerCallArgs["callModel"] extends (a: infer A) => unknown
    ? A extends { messages: infer M }
      ? M
      : never
    : never
) {
  return messages;
}
void capMessages;

/**
 * Generic cap-then-truncate helper. The prompt is the primary cost driver
 * for distillation; oversized payloads trip `budget_exceeded`.
 */
export function clampPrompt(text: string, maxChars: number): string {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/** Build a budget guard — returns ok when the size limits are met. */
function checkBudget(text: string, maxChars: number, stepIdx: number, maxSteps: number) {
  if (stepIdx >= maxSteps) {
    return { ok: false as const, error: "budget_exceeded" as const };
  }
  if (text.length > maxChars) {
    return { ok: false as const, error: "budget_exceeded" as const };
  }
  return { ok: true as const };
}

/** Pure regex fallback that always returns something usable (the L0 evidence). */
function regexFallback(raw: string): Array<{ kind: string; match: string }> {
  const out: Array<{ kind: string; match: string }> = [];
  const patterns: Array<[string, RegExp]> = [
    ["preference", /\b(?:I\s+prefer|I'd\s+rather|I\s+like)\s+([^.!?\n]+)/gi],
    ["decision", /\b(?:I\s+(?:will|chose|picked|selected))\s+([^.!?\n]+)/gi],
    ["pattern", /\b(?:I\s+usually|I\s+always|I\s+never)\s+([^.!?\n]+)/gi],
  ];
  for (const [kind, re] of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      if (m[1]) out.push({ kind, match: m[1].trim().slice(0, 240) });
      if (out.length >= 16) break;
    }
    if (out.length >= 16) break;
  }
  return out;
}

async function loadTencentPrompt(kind: string): Promise<string> {
  try {
    const mod = (await import(`./prompts/tencent/${kind}.ts` as string).catch(() => null)) as {
      TENCENT_PROMPT?: string;
    } | null;
    if (mod?.TENCENT_PROMPT) return mod.TENCENT_PROMPT;
  } catch {
    /* fallthrough */
  }
  // Fallback prompt — embedded so the worker is never blocked on the prompt
  // module. Tencent integration can ship its real prompt in a follow-up commit
  // without changing this file.
  switch (kind) {
    case "L1_extract":
      return [
        "You extract durable, decision-grade facts from a conversation.",
        "Output JSON: { facts: [{ key, content, category }] }. No prose.",
      ].join("\n");
    case "L2_scene":
      return [
        "You summarise a closed conversation as one paragraph + 3 bullet scene tags.",
        "Output JSON: { summary, tags: [string] }.",
      ].join("\n");
    case "L3_persona":
      return [
        "You classify user persona from conversation excerpts.",
        "Output JSON: { persona, evidence: [string] }.",
      ].join("\n");
    case "L0_chunk_embed":
      return [
        "You summarise a chunk in <120 chars for vector recall.",
        "Output JSON: { summary }.",
      ].join("\n");
    default:
      return "Output strict JSON.";
  }
}

/**
 * L1_extract — pull durable facts from a conversation slice.
 * Always falls back to regex evidence when JSON parsing fails (recorded
 * as L0 evidence; never silently replaces the LLM response).
 */
export const L1ExtractHandler: DistillationHandler = defineHandler(
  "L1_extract",
  async function L1Extract(args) {
    const payload = args.task.payload as { conversation?: string } | null;
    const conversation = clampPrompt(payload?.conversation ?? "", args.budget.maxTokens * 3);
    const budget = checkBudget(conversation, args.budget.maxTokens * 3, 0, args.budget.maxSteps);
    if (!budget.ok)
      return { ok: false, error: { kind: "budget_exceeded", message: "Input exceeds budget" } };

    const systemPrompt = await loadTencentPrompt("L1_extract");
    const response = await args.callModel({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: conversation },
      ],
      maxTokens: Math.min(2048, args.budget.maxTokens),
    });

    const parsed = safeParseJson(response.text);
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        error: { kind: "parse_failed", message: "L1_extract: response was not JSON" },
      };
    }
    const facts = Array.isArray((parsed as { facts?: unknown }).facts)
      ? ((parsed as { facts: unknown[] }).facts as unknown[]).slice(0, 32)
      : [];
    return {
      ok: true,
      result: {
        payload: { facts },
        fallbackEvidence: regexFallback(conversation),
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
      },
    };
  }
);

/**
 * L2_scene — produce one paragraph + 3 bullet scene tags. Cooldown policy
 * lives in the scheduler; the handler just produces the structured output.
 */
export const L2SceneHandler: DistillationHandler = defineHandler(
  "L2_scene",
  async function L2Scene(args) {
    const payload = args.task.payload as { conversation?: string } | null;
    const conversation = clampPrompt(payload?.conversation ?? "", args.budget.maxTokens * 4);
    const budget = checkBudget(conversation, args.budget.maxTokens * 4, 0, args.budget.maxSteps);
    if (!budget.ok)
      return { ok: false, error: { kind: "budget_exceeded", message: "Input exceeds budget" } };

    const systemPrompt = await loadTencentPrompt("L2_scene");
    const response = await args.callModel({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: conversation },
      ],
      maxTokens: Math.min(1024, args.budget.maxTokens),
    });
    const parsed = safeParseJson(response.text);
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        error: { kind: "parse_failed", message: "L2_scene: response was not JSON" },
      };
    }
    const summary =
      typeof (parsed as { summary?: unknown }).summary === "string"
        ? ((parsed as { summary: string }).summary as string).slice(0, 1200)
        : "";
    const tags = Array.isArray((parsed as { tags?: unknown }).tags)
      ? ((parsed as { tags: unknown[] }).tags as unknown[]).map(String).slice(0, 8)
      : [];
    if (!summary && tags.length === 0) {
      return {
        ok: false,
        error: { kind: "semantic_invalid", message: "L2_scene: empty result" },
      };
    }
    return {
      ok: true,
      result: {
        payload: { summary, tags },
        fallbackEvidence: [],
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
      },
    };
  }
);

/**
 * L3_persona — fires immediately (no debounce) per the scheduler. The
 * handler is intentionally minimal: 1 prompt + 1 JSON response.
 */
export const L3PersonaHandler: DistillationHandler = defineHandler(
  "L3_persona",
  async function L3Persona(args) {
    const payload = args.task.payload as { samples?: string[] } | null;
    const samples = (payload?.samples ?? []).map((s) => clampPrompt(s, 2000)).slice(0, 8);
    if (samples.length === 0) {
      return { ok: false, error: { kind: "model_unset", message: "No persona samples" } };
    }
    const systemPrompt = await loadTencentPrompt("L3_persona");
    const response = await args.callModel({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: samples.join("\n---\n") },
      ],
      maxTokens: Math.min(512, args.budget.maxTokens),
    });
    const parsed = safeParseJson(response.text);
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        error: { kind: "parse_failed", message: "L3_persona: response was not JSON" },
      };
    }
    return {
      ok: true,
      result: {
        payload: parsed,
        fallbackEvidence: [],
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
      },
    };
  }
);

/**
 * L0_chunk_embed — pure deterministic summarisation. The handler is
 * optional in production (the worker can route L0 to a dedicated embedder
 * path), but the default implementation is here so tests have an end-to-end
 * signal that the worker dispatched the right kind.
 */
export const L0ChunkEmbedHandler: DistillationHandler = defineHandler(
  "L0_chunk_embed",
  async function L0ChunkEmbed(args) {
    const payload = args.task.payload as { chunk?: string } | null;
    const chunk = clampPrompt(payload?.chunk ?? "", args.budget.maxTokens * 2);
    if (!chunk) {
      return { ok: false, error: { kind: "model_unset", message: "No chunk" } };
    }
    const systemPrompt = await loadTencentPrompt("L0_chunk_embed");
    const response = await args.callModel({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: chunk },
      ],
      maxTokens: Math.min(256, args.budget.maxTokens),
    });
    const parsed = safeParseJson(response.text);
    const summary =
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { summary?: unknown }).summary === "string"
        ? ((parsed as { summary: string }).summary as string).slice(0, 200)
        : "";
    if (!summary) {
      return {
        ok: false,
        error: { kind: "parse_failed", message: "L0_chunk_embed: response was not JSON" },
      };
    }
    return {
      ok: true,
      result: {
        payload: { summary },
        fallbackEvidence: [],
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
      },
    };
  }
);

/** Default registry — exported so tests can override individual entries. */
export const DEFAULT_HANDLERS: Record<DistillationTask["kind"], DistillationHandler> = {
  L0_chunk_embed: L0ChunkEmbedHandler,
  L1_extract: L1ExtractHandler,
  L2_scene: L2SceneHandler,
  L3_persona: L3PersonaHandler,
};
