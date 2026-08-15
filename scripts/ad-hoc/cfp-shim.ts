/**
 * cfp-shim v2 — standalone OpenAI-compatible bridge for Cloudflare AI Playground.
 * Self-contained (protocol ported from the OmniRoute executor, validated
 * against live captures). Only external dep: `playwright` (from the repo).
 *
 * Run:  CLOUDFLARE_PLAYGROUND_CHROME_PATH=<chrome> tsx /tmp/cfp-shim/shim.ts
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";

const PLAYGROUND_URL = "https://playground.ai.cloudflare.com/";
const PLAYGROUND_WS_BASE = "wss://playground.ai.cloudflare.com/agents/playground/";
const PLAYGROUND_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
];
const MODEL_PREFIX = "@cf/";
const DEFAULT_MODEL = "zai-org/glm-4.7-flash";
const DEFAULT_TEMPERATURE = 0.7;
const NAV_TIMEOUT_MS = 45_000;
const CHAT_TIMEOUT_MS = 120_000;
const PORT = Number(process.env.CFP_SHIM_PORT || 4989);

// ── Model catalog (mirror of the registry entry) ────────────────────────────
const MODELS = [
  "zai-org/glm-5.2",
  "zai-org/glm-4.7-flash",
  "zai-org/glm-4.7-flash-250905",
  "zai-org/glm-4.6",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k2.5",
  "deepseek-ai/deepseek-v4-pro-0813",
  "deepseek-ai/deepseek-v4-flash-0731",
  "deepseek-ai/deepseek-r1-0528",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "meta-llama/llama-3.3-70b-instruct-fp8-fast",
  "meta-llama/llama-3.1-8b-instruct",
  "qwen/qwen2.5-coder-32b-instruct",
  "qwen/qwen2.5-72b-instruct",
  "google/gemma-2-27b-it",
  "microsoft/phi-4-mini-it",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "thudm/glm-4-9b-chat",
  "x-ai/grok-4-fast-mini",
];

// ── Frame parsing & translation (from the executor, unit-tested) ────────────
interface CfChatFrame {
  id?: string;
  type?: string;
  error?: boolean;
  done?: boolean;
  body?: unknown;
}

function parseCfFrame(raw: string): CfChatFrame | null {
  try {
    const msg = JSON.parse(raw) as CfChatFrame;
    if (msg && typeof msg === "object" && typeof msg.type === "string") return msg;
  } catch {
    /* non-JSON — ignore */
  }
  return null;
}

interface CfStreamEvent {
  type: "role" | "content" | "finish";
  value?: string;
}

class CfStreamParser {
  readonly chatId: string;
  done = false;
  text = "";
  finishReason: string | null = null;
  error: { status: number; message: string } | null = null;
  private seenStart = false;

  constructor(chatId: string) {
    this.chatId = chatId;
  }

  push(raw: string): CfStreamEvent | null {
    const msg = parseCfFrame(raw);
    if (!msg || msg.type !== "cf_agent_use_chat_response" || msg.id !== this.chatId) return null;

    if (msg.error) {
      this.error = classifyError(msg.body);
      return null;
    }
    if (msg.done) {
      this.done = true;
      return null;
    }

    let body: Record<string, unknown>;
    try {
      body =
        typeof msg.body === "string"
          ? (JSON.parse(msg.body) as Record<string, unknown>)
          : (msg.body as Record<string, unknown>);
    } catch {
      return null;
    }
    if (!body || typeof body.type !== "string") return null;

    switch (body.type) {
      case "start":
        if (this.seenStart) return null;
        this.seenStart = true;
        return { type: "role" };
      case "text-delta": {
        const delta = typeof body.delta === "string" ? body.delta : "";
        if (!delta) return null;
        this.text += delta;
        return { type: "content", value: delta };
      }
      case "finish": {
        const meta = (body.messageMetadata ?? {}) as Record<string, unknown>;
        const reason = typeof meta.finishReason === "string" ? meta.finishReason : "stop";
        this.finishReason = reason;
        return { type: "finish", value: reason };
      }
      default:
        return null;
    }
  }
}

function classifyError(body: unknown): { status: number; message: string } {
  let detail = "";
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      detail = String(parsed.details || parsed.message || "");
    } catch {
      detail = body;
    }
  } else if (body && typeof body === "object") {
    const parsed = body as Record<string, unknown>;
    detail = String(parsed.details || parsed.message || "");
  }
  const status = /rate|limit|quota|throttl/i.test(detail) ? 429 : 502;
  return { status, message: detail || "Cloudflare Playground upstream error" };
}

interface CfChatMessage {
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
  id: string;
}

function toCfMessages(messages: Array<{ role?: string; content?: unknown }>): CfChatMessage[] {
  const out: CfChatMessage[] = [];
  for (const message of messages ?? []) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    let text = "";
    if (typeof message.content === "string") {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      text = message.content
        .map((part) =>
          typeof part === "string" ? part : ((part as { text?: string })?.text ?? "")
        )
        .filter(Boolean)
        .join("\n");
    }
    if (!text) continue;
    out.push({ role: message.role, parts: [{ type: "text", text }], id: `m${out.length + 1}` });
  }
  return out;
}

// ── Browser transport ───────────────────────────────────────────────────────
function openPlaygroundSession(args: {
  chatId: string;
  model: string;
  messages: CfChatMessage[];
  temperature: number;
  wsBase: string;
}): void {
  const { chatId, model, messages, temperature, wsBase } = args;
  const pk = crypto.randomUUID();
  const room = "playground-" + crypto.randomUUID().replace(/-/g, "").slice(0, 25);
  const socket = new WebSocket(wsBase + room + "?_pk=" + pk);
  const push = (raw: string) => {
    try {
      (window as unknown as { __cfpPush: (raw: string) => void }).__cfpPush(raw);
    } catch {
      /* page torn down */
    }
  };
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "cf_agent_stream_resume_request" }));
    socket.send(
      JSON.stringify({
        type: "rpc",
        id: "cfp-config",
        method: "setConfig",
        args: [{ model, temperature, stream: true }],
      })
    );
    socket.send(
      JSON.stringify({
        id: chatId,
        init: { method: "POST", body: JSON.stringify({ messages, trigger: "submit-message" }) },
        type: "cf_agent_use_chat_request",
      })
    );
  };
  socket.onmessage = (event: MessageEvent) => push(String(event.data));
  socket.onerror = () =>
    push(
      JSON.stringify({
        id: chatId,
        type: "cf_agent_use_chat_response",
        error: true,
        body: JSON.stringify({
          message: "Playground WebSocket error",
          details: "ws transport failed",
        }),
      })
    );
}

class PlaywrightCfTransport {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private pending: string[] = [];
  private waiters: Array<(frame: string | null) => void> = [];
  private closed = false;

  constructor(private chatId: string) {}

  async start(config: {
    model: string;
    messages: CfChatMessage[];
    temperature: number;
    signal?: AbortSignal | null;
  }): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    try {
      const executablePath = process.env.CLOUDFLARE_PLAYGROUND_CHROME_PATH;
      this.browser = await chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: BROWSER_ARGS,
      });
      const context = await this.browser.newContext({ userAgent: PLAYGROUND_UA });
      const page = await context.newPage();
      this.page = page;
      await page.goto(PLAYGROUND_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const title = await page.title().catch(() => "");
      if (title.includes("Attention Required")) {
        return { ok: false, status: 502, message: "Cloudflare blocked the browser session" };
      }
      await page.exposeFunction("__cfpPush", (raw: string) => {
        this.push(raw);
      });
      // tsx/esbuild injects a `__name` helper into serialized functions; define
      // it in the page context so page.evaluate(openPlaygroundSession) works.
      await page.evaluate(() => {
        (window as unknown as { __name?: unknown }).__name = (fn: unknown) => fn;
      });
      await page.evaluate(openPlaygroundSession, {
        ...config,
        chatId: this.chatId,
        wsBase: PLAYGROUND_WS_BASE,
      });
      return { ok: true };
    } catch (error) {
      await this.close().catch(() => {});
      return {
        ok: false,
        status: 502,
        message: `Cloudflare Playground browser session failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  push(raw: string): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(raw);
    else this.pending.push(raw);
  }

  async *frames(): AsyncGenerator<string> {
    while (this.pending.length > 0 || !this.closed) {
      if (this.pending.length > 0) {
        yield this.pending.shift()!;
        continue;
      }
      const frame = await new Promise<string | null>((resolve) => this.waiters.push(resolve));
      if (frame === null) return;
      yield frame;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => {});
  }
}

// ── OpenAI-compatible surface ───────────────────────────────────────────────
function sseChunk(
  cid: string,
  created: number,
  model: string,
  payload: { delta?: Record<string, unknown>; finish_reason?: string | null; error?: unknown }
): string {
  const base = { id: cid, object: "chat.completion.chunk", created, model };
  if (payload.error) {
    return `data: ${JSON.stringify({ ...base, error: payload.error })}\n\n`;
  }
  return `data: ${JSON.stringify({
    ...base,
    choices: [
      { index: 0, delta: payload.delta ?? {}, finish_reason: payload.finish_reason ?? null },
    ],
  })}\n\n`;
}

async function runChat(bodyObj: Record<string, unknown>, signal: AbortSignal) {
  const rawModel = (bodyObj.model as string) || DEFAULT_MODEL;
  const model = rawModel.startsWith(MODEL_PREFIX) ? rawModel : MODEL_PREFIX + rawModel;
  const temperature =
    typeof bodyObj.temperature === "number" ? bodyObj.temperature : DEFAULT_TEMPERATURE;
  const chatId = `chatcmpl-cfp-${randomUUID().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);
  const wantStream = bodyObj.stream === true;
  const messages = toCfMessages(
    (bodyObj.messages as Array<{ role?: string; content?: unknown }>) || []
  );

  const transport = new PlaywrightCfTransport(chatId);
  const started = await transport.start({ model, messages, temperature, signal });
  if (started.ok !== true) {
    return {
      status: started.status,
      body: JSON.stringify({
        error: { message: started.message, type: "upstream_error", code: `HTTP_${started.status}` },
      }),
      headers: { "Content-Type": "application/json" },
    };
  }

  const timedOut = { current: false };
  const timer = setTimeout(() => {
    timedOut.current = true;
    void transport.close();
  }, CHAT_TIMEOUT_MS);

  try {
    if (!wantStream) {
      const parser = new CfStreamParser(chatId);
      for await (const raw of transport.frames()) {
        parser.push(raw);
        if (parser.error || parser.done) break;
      }
      if (parser.error) {
        return {
          status: parser.error.status,
          body: JSON.stringify({
            error: {
              message: parser.error.message,
              type: "upstream_error",
              code: `HTTP_${parser.error.status}`,
            },
          }),
          headers: { "Content-Type": "application/json" },
        };
      }
      if (timedOut.current && !parser.text) {
        return {
          status: 504,
          body: JSON.stringify({
            error: { message: "Cloudflare Playground timed out", type: "timeout" },
          }),
          headers: { "Content-Type": "application/json" },
        };
      }
      const text = parser.text;
      return {
        status: 200,
        body: JSON.stringify({
          id: chatId,
          object: "chat.completion",
          created,
          model: rawModel,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: text },
              finish_reason: parser.finishReason ?? "stop",
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: Math.ceil(text.length / 4),
            total_tokens: 0,
          },
        }),
        headers: { "Content-Type": "application/json" },
      };
    }

    // Streaming
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const parser = new CfStreamParser(chatId);
        let roleSent = false;
        const enqueue = (payload: {
          delta?: Record<string, unknown>;
          finish_reason?: string | null;
          error?: unknown;
        }) => {
          controller.enqueue(encoder.encode(sseChunk(chatId, created, rawModel, payload)));
        };
        try {
          for await (const raw of transport.frames()) {
            if (signal.aborted) break;
            const event = parser.push(raw);
            if (event) {
              if (event.type === "role" && !roleSent) {
                enqueue({ delta: { role: "assistant" }, finish_reason: null });
                roleSent = true;
              } else if (event.type === "content") {
                enqueue({ delta: { content: event.value }, finish_reason: null });
              } else if (event.type === "finish") {
                enqueue({ delta: {}, finish_reason: event.value ?? "stop" });
              }
            }
            if (parser.error) {
              enqueue({
                error: {
                  message: parser.error.message,
                  type: "upstream_error",
                  code: `HTTP_${parser.error.status}`,
                },
              });
              break;
            }
            if (parser.done || timedOut.current) break;
          }
        } catch (error) {
          if (!signal.aborted) controller.error(error);
        } finally {
          clearTimeout(timer);
          await transport.close().catch(() => {});
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });
    return {
      status: 200,
      body: stream,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    };
  } finally {
    if (!wantStream) {
      clearTimeout(timer);
      await transport.close().catch(() => {});
    }
  }
}

function normalizeModel(model: string): string {
  const parts = model.split("/");
  return parts.length >= 3 ? parts.slice(1).join("/") : model;
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, models: MODELS.length }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: MODELS.map((id) => ({ id, object: "model", owned_by: "cloudflare-playground" })),
        })
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      body.model = normalizeModel(String(body.model || DEFAULT_MODEL));

      const controller = new AbortController();
      req.on("close", () => controller.abort());

      const out = await runChat(body, controller.signal);
      res.writeHead(out.status, out.headers);
      if (out.body instanceof ReadableStream) {
        const reader = out.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
        res.end(out.body as string);
      }
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `no route: ${req.method} ${url.pathname}` } }));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: String((e as Error)?.message || e) } }));
  }
});

server.listen(PORT, () => {
  console.log(`[cfp-shim] listening on :${PORT} — ${MODELS.length} models`);
});
