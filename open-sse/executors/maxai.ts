/**
 * MaxAiExecutor — MaxAI web-app chat as an OpenAI-compatible OmniRoute provider.
 *
 * MaxAI (chat.maxai.co / api.maxai.me) is a consumer web app with no public API.
 * This executor reproduces the web app's own signed request to `/gpt/cwc/chat`:
 *   • per-request `X-Authorization` signature (see ./signing.ts),
 *   • Firefox-150 identity headers + Bearer access token,
 *   • the full OpenAI transcript flattened into one `message_content` block
 *     (stateless-full-history; see ./protocol.ts),
 *   • SSE response parsed for text deltas, with inline `<think>` reasoning split
 *     out into `reasoning_content` (see ./stream.ts).
 *
 * Egress + TLS: the request MUST exit a residential IP (MaxAI bot-bans datacenter
 * IPs). OmniRoute routes the executor's `fetch()` through the per-connection proxy
 * (a residential HTTP proxy) transparently, and applies the wreq-js Firefox TLS
 * fingerprint when enabled. This executor does not open its own socket; it uses
 * the ambient patched `fetch`, so the proxy + TLS overlay apply automatically.
 *
 * Auth refresh: MaxAI's `/oauth/refresh_access_token` is deep-TLS-gated and cannot
 * be called by any HTTP client (only a real browser passes). The access token is
 * therefore minted/refreshed out-of-band by OmniRoute's own browser-mint flow
 * (see maxaiBrowserLogin); this executor only consumes the stored credential.
 */
import { BaseExecutor, type ExecuteInput, type ExecutorExecuteResult } from "./base.ts";
import { PROVIDERS } from "../config/constants.ts";
import { sanitizeErrorMessage } from "../utils/error.ts";
import { resolveMaxaiCredential, type MaxaiCredential } from "./maxai/credentials.ts";
import { buildMaxaiSignedHeaders } from "./maxai/signing.ts";
import {
  maxaiAccessTokenNeedsRefresh,
  maxaiRefreshAccessToken,
} from "./maxai/refresh.ts";
import {
  assembleMaxaiContext,
  buildMaxaiChatBody,
  MAXAI_BASE_URL,
  MAXAI_CHAT_PATH,
  maxaiStaticHeaders,
  newConversationId,
} from "./maxai/protocol.ts";
import { estimateMaxaiTokens, isMaxaiTextFrame, ThinkSplitter } from "./maxai/stream.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
};

interface OpenAiChatBody {
  messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }>;
  model?: string;
}

function errorResponse(status: number, message: string, code: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: sanitizeErrorMessage(message),
        type: status >= 500 ? "provider_error" : "invalid_request_error",
      },
    }),
    { status, headers: JSON_HEADERS }
  );
}

/** Emit one OpenAI `chat.completion.chunk`. */
function chunk(
  controller: ReadableStreamDefaultController,
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finish: string | null = null
): void {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
}

export class MaxAiExecutor extends BaseExecutor {
  constructor() {
    super("maxai", PROVIDERS.maxai ?? { id: "maxai", baseUrl: MAXAI_BASE_URL });
  }

  override async execute(input: ExecuteInput): Promise<ExecutorExecuteResult> {
    const cred = resolveMaxaiCredential(
      input.credentials?.providerSpecificData,
      input.credentials?.accessToken
    );
    if (!cred) {
      return errorResponse(
        401,
        "MaxAI connection is not configured (missing access token, device id, or user id). Sign in to mint a token.",
        "maxai_unconfigured"
      );
    }

    // Proactively refresh a near-expiry access token (browserless; see ./maxai/refresh.ts).
    // Failures here are non-fatal: we fall through with the existing token, and a
    // genuinely-dead token surfaces as a 401/418 below (prompting a re-mint).
    const accessToken = await this.ensureFreshAccess(cred, input);

    const body = (input.body ?? {}) as OpenAiChatBody;
    let text: string;
    try {
      text = assembleMaxaiContext(body.messages ?? []);
    } catch {
      return errorResponse(400, "No user message to send to MaxAI.", "maxai_empty_request");
    }

    const conversationId = newConversationId();
    const chatBody = buildMaxaiChatBody({
      conversationId,
      text,
      modelName: input.model,
    });

    const signedHeaders = buildMaxaiSignedHeaders({
      path: MAXAI_CHAT_PATH,
      userId: cred.userId,
      deviceId: cred.deviceId,
    });
    const headers: Record<string, string> = {
      ...maxaiStaticHeaders(),
      ...signedHeaders,
      Authorization: `Bearer ${accessToken}`,
      ...(input.upstreamExtraHeaders ?? {}),
    };

    const url = MAXAI_BASE_URL + MAXAI_CHAT_PATH;
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(chatBody),
        signal: input.signal ?? undefined,
      });
    } catch (err) {
      return errorResponse(
        502,
        `MaxAI request failed: ${sanitizeErrorMessage(err instanceof Error ? err.message : err)}`,
        "maxai_transport_error"
      );
    }

    if (upstream.status !== 200 || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      // 401/418 = auth expired/masked-reject; surface so the caller can prompt a re-mint.
      const status = upstream.status === 418 ? 401 : upstream.status || 502;
      return errorResponse(
        status,
        `MaxAI upstream ${upstream.status}: ${sanitizeErrorMessage(detail.slice(0, 300))}`,
        upstream.status === 401 || upstream.status === 418 ? "maxai_auth_error" : "maxai_upstream_error"
      );
    }

    const id = `chatcmpl-${conversationId}`;
    const created = Math.floor(Date.now() / 1000);
    const promptTokens = estimateMaxaiTokens(text);

    if (input.stream) {
      const stream = this.buildStream(upstream.body, id, created, input.model, promptTokens);
      return { response: new Response(stream, { status: 200, headers: SSE_HEADERS }), url };
    }

    // Non-streaming: collect the whole SSE body, split think, build a chat.completion.
    const raw = await upstream.text();
    const { reasoning, answer } = collectNonStream(raw);
    const completionTokens = estimateMaxaiTokens(reasoning + answer);
    const response = {
      id,
      object: "chat.completion",
      created,
      model: input.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: answer,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
    return { response: new Response(JSON.stringify(response), { status: 200, headers: JSON_HEADERS }), url };
  }

  /**
   * Return a non-expired access token, refreshing browserlessly when the stored
   * one is missing or within the expiry margin and a refresh token is available.
   * Persists a freshly-minted token via `onCredentialsRefreshed`. Never throws —
   * on any refresh failure it returns the original token so the request still
   * proceeds (a truly-dead token then surfaces as an upstream 401/418).
   */
  private async ensureFreshAccess(
    cred: MaxaiCredential,
    input: ExecuteInput
  ): Promise<string> {
    if (!cred.refreshToken) return cred.accessToken;
    if (!maxaiAccessTokenNeedsRefresh(cred.accessToken)) return cred.accessToken;

    const result = await maxaiRefreshAccessToken({
      refreshToken: cred.refreshToken,
      deviceId: cred.deviceId,
      userId: cred.userId,
      signal: input.signal ?? undefined,
    });
    if (!result.ok || !result.accessToken) {
      input.log?.warn?.("maxai", `access-token refresh failed (${result.status}); using existing token`);
      return cred.accessToken;
    }

    // Persist the new access token (merged into providerSpecificData) so the next
    // request starts fresh. The refresh token and device id are unchanged.
    try {
      await input.onCredentialsRefreshed?.({
        accessToken: result.accessToken,
        providerSpecificData: {
          ...(input.credentials?.providerSpecificData ?? {}),
          maxaiAccessToken: result.accessToken,
        },
      });
    } catch (err) {
      input.log?.warn?.(
        "maxai",
        `refreshed token persist failed: ${sanitizeErrorMessage(err instanceof Error ? err.message : err)}`
      );
    }
    return result.accessToken;
  }

  /** Bridge the MaxAI SSE body into an OpenAI chat.completion.chunk stream. */
  private buildStream(
    source: ReadableStream<Uint8Array>,
    id: string,
    created: number,
    model: string,
    promptTokens: number
  ): ReadableStream {
    const splitter = new ThinkSplitter();
    const decoder = new TextDecoder();
    let sseBuf = "";
    let sentRole = false;
    let completionChars = 0;

    const emitDelta = (controller: ReadableStreamDefaultController, r: string, a: string) => {
      if (!sentRole && (r || a)) {
        chunk(controller, id, created, model, { role: "assistant" });
        sentRole = true;
      }
      if (r) {
        chunk(controller, id, created, model, { reasoning_content: r });
        completionChars += r.length;
      }
      if (a) {
        chunk(controller, id, created, model, { content: a });
        completionChars += a.length;
      }
    };

    const processFrame = (controller: ReadableStreamDefaultController, jsonStr: string) => {
      if (!jsonStr || jsonStr === "[DONE]") return;
      let frame: unknown;
      try {
        frame = JSON.parse(jsonStr);
      } catch {
        return;
      }
      if (isMaxaiTextFrame(frame)) {
        const { reasoning, answer } = splitter.feed(frame.text);
        emitDelta(controller, reasoning, answer);
      }
    };

    return new ReadableStream({
      async start(controller) {
        const reader = source.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = sseBuf.indexOf("\n")) !== -1) {
              const line = sseBuf.slice(0, nl).trim();
              sseBuf = sseBuf.slice(nl + 1);
              if (line.startsWith("data:")) processFrame(controller, line.slice(5).trim());
            }
          }
          // flush held tail from the think splitter
          const tail = splitter.flush();
          emitDelta(controller, tail.reasoning, tail.answer);
          // final chunk with usage + finish
          const completionTokens = estimateMaxaiTokens("x".repeat(completionChars));
          const finalChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          try {
            controller.error(err);
          } catch {
            /* already errored */
          }
        } finally {
          reader.releaseLock();
        }
      },
    });
  }
}

/** Collect a full MaxAI SSE body into split { reasoning, answer } (non-stream). */
function collectNonStream(raw: string): { reasoning: string; answer: string } {
  const splitter = new ThinkSplitter();
  let reasoning = "";
  let answer = "";
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("data:")) continue;
    const js = s.slice(5).trim();
    if (!js || js === "[DONE]") continue;
    let frame: unknown;
    try {
      frame = JSON.parse(js);
    } catch {
      continue;
    }
    if (isMaxaiTextFrame(frame)) {
      const out = splitter.feed(frame.text);
      reasoning += out.reasoning;
      answer += out.answer;
    }
  }
  const tail = splitter.flush();
  return { reasoning: reasoning + tail.reasoning, answer: answer + tail.answer };
}
