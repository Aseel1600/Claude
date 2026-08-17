import {
  BaseExecutor,
  type ExecuteInput,
  type ExecutorExecuteResult,
} from "./base.ts";
import { errorResponse, sanitizeErrorMessage } from "../utils/error.ts";

export const FREEBUFF_BASE_URL = "https://www.codebuff.com/api/v1";
const FREEBUFF_SESSION_URL = `${FREEBUFF_BASE_URL}/freebuff/session`;
const FREEBUFF_AGENT_RUNS_URL = `${FREEBUFF_BASE_URL}/agent-runs`;
const FREEBUFF_COMPLETIONS_URL = `${FREEBUFF_BASE_URL}/chat/completions`;
const FREEBUFF_SYSTEM_PROMPT = "You are Buffy, the strategic coding assistant.";

const MODEL_TO_AGENT: Record<string, string> = {
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base2-free-deepseek",
  "openai/gpt-5.6-luna": "base2-free-luna",
  "minimax/minimax-m3": "base2-free-minimax-m3",
  "mimo/mimo-v2.5": "base2-free-mimo",
  "z-ai/glm-5.2": "base2-free-glm",
  "crof/kimi-k3-eco": "base2-free-kimi-k3-eco",
  "anthropic/claude-fable-5": "base2-free-fable",
  "meta/muse-spark-1.2-contributor": "base2-free-muse-spark",
};

function generateClientSessionId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 13; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Narrow an `unknown` chat body to a record; never throws. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Strip a `freebuff/` model prefix so `freebuff/deepseek-v4-flash` resolves like `deepseek-v4-flash`. */
function normalizeModel(model: unknown): string {
  if (typeof model !== "string" || !model) return "deepseek/deepseek-v4-flash";
  return model.replace(/^freebuff\//, "");
}

interface ChatMessageLike {
  role?: string;
  content?: unknown;
}

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", { id: "freebuff", baseUrl: FREEBUFF_BASE_URL, format: "openai" });
  }

  override async execute(input: ExecuteInput): Promise<ExecutorExecuteResult> {
    const { model, body, stream, credentials, signal } = input;
    const token = credentials?.apiKey || credentials?.accessToken || "";

    if (!token) {
      return { response: errorResponse(401, "Freebuff Auth Token required") };
    }

    const requestedModel = normalizeModel(model);
    const agentId = MODEL_TO_AGENT[requestedModel] || "base2-free";

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "codebuff/0.1.0 (darwin-arm64)",
    };

    let instanceId = "";
    let runId = "";

    // 1. Session acquisition
    try {
      const sessionRes = await fetch(FREEBUFF_SESSION_URL, {
        method: "POST",
        headers: {
          ...authHeaders,
          "x-freebuff-model": requestedModel,
        },
        body: JSON.stringify({}),
        signal,
      });
      if (sessionRes.ok) {
        const data = (await sessionRes.json()) as { instanceId?: string };
        instanceId = data.instanceId || "";
      } else {
        const errText = await sessionRes.text();
        return {
          response: errorResponse(
            sessionRes.status,
            `Freebuff session failed (${sessionRes.status}): ${sanitizeErrorMessage(errText)}`
          ),
        };
      }
    } catch (e: unknown) {
      const msg = sanitizeErrorMessage(e instanceof Error ? e.message : String(e));
      return { response: errorResponse(502, `Freebuff session network error: ${msg}`) };
    }

    // 2. Start agent run (best-effort — a missing run id still allows the completion call)
    try {
      const runRes = await fetch(FREEBUFF_AGENT_RUNS_URL, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action: "START", agentId }),
        signal,
      });
      if (runRes.ok) {
        const runData = (await runRes.json()) as { runId?: string };
        runId = runData.runId || "";
      }
    } catch {}

    // 3. Prepare Chat Payload & Buffy System Prompt
    const bodyRecord = asRecord(body);
    const rawMessages = Array.isArray(bodyRecord.messages) ? bodyRecord.messages : [];
    const incomingMessages: ChatMessageLike[] = rawMessages.filter(
      (m): m is ChatMessageLike =>
        m !== null && typeof m === "object" && !Array.isArray(m)
    );
    const hasBuffyPrompt =
      incomingMessages.length > 0 &&
      incomingMessages[0].role === "system" &&
      typeof incomingMessages[0].content === "string" &&
      (incomingMessages[0].content as string).trim().startsWith("You are Buffy");

    if (!hasBuffyPrompt) {
      incomingMessages.unshift({ role: "system", content: FREEBUFF_SYSTEM_PROMPT });
    }

    const clientSessionId = generateClientSessionId();
    const existingMetadata = asRecord(bodyRecord.codebuff_metadata);
    const upstreamBody = {
      ...bodyRecord,
      model: requestedModel,
      messages: incomingMessages,
      stream: stream !== false,
      codebuff_metadata: {
        run_id: runId,
        cost_mode: "free",
        client_id: clientSessionId,
        freebuff_instance_id: instanceId,
        ...existingMetadata,
      },
    };

    const completionHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ai-sdk/openai-compatible/1.0.25/codebuff",
      Accept: "application/json, text/event-stream",
      "x-freebuff-instance-id": instanceId,
      "x-codebuff-agent-id": agentId,
    };
    if (runId) completionHeaders["x-codebuff-run-id"] = runId;

    // 4. Chat Completion
    const response = await fetch(FREEBUFF_COMPLETIONS_URL, {
      method: "POST",
      headers: completionHeaders,
      body: JSON.stringify(upstreamBody),
      signal,
    });

    // 5. Finish agent run (background, best-effort)
    if (runId) {
      void fetch(FREEBUFF_AGENT_RUNS_URL, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          action: "FINISH",
          runId,
          status: "completed",
          totalSteps: 1,
          directCredits: 0,
          totalCredits: 0,
        }),
      }).catch(() => {});
    }

    return { response, url: FREEBUFF_COMPLETIONS_URL, headers: completionHeaders };
  }
}
