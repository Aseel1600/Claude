import {
  BaseExecutor,
  mergeUpstreamExtraHeaders,
  type ExecuteInput,
  type ExecutorLog,
  type ProviderCredentials,
} from "./base.ts";
import { PROVIDERS, STREAM_READINESS_TIMEOUT_MS } from "../config/constants.ts";
import { v4 as uuidv4 } from "uuid";
import { refreshKiroToken } from "../services/tokenRefresh.ts";
import {
  isExternalIdpAuthMethod,
  KIRO_EXTERNAL_IDP_TOKEN_TYPE_HEADER,
  KIRO_EXTERNAL_IDP_TOKEN_TYPE_VALUE,
} from "../services/kiroExternalIdp.ts";
import {
  splitInlineThinking,
  flushPendingThinking,
  type KiroThinkingState,
} from "./kiroThinking.ts";
import { ByteQueue, TEXT_ENCODER, parseEventFrame } from "./kiro/eventstream.ts";
import { kiroRuntimeHost, resolveKiroRuntimeRegion } from "../services/kiroRegion.ts";
import { sanitizeErrorMessage } from "../utils/error.ts";

type JsonRecord = Record<string, unknown>;

type KiroRepairGateOptions = {
  thinkingExpected?: boolean;
  signal?: AbortSignal;
  maxBufferBytes: number;
  ttftTimeoutMs: number;
  stallTimeoutMs: number;
  suppressInvalidToolCallError: boolean;
  invalidToolCallErrorCode?: string;
};

type KiroRepairGateResult =
  | { kind: "stream"; firstChunk: Uint8Array; reader: ReadableStreamDefaultReader<Uint8Array> }
  | { kind: "complete"; bytes: Uint8Array }
  | { kind: "invalid"; invalidToolCall: string }
  | { kind: "buffer_exceeded" };

type UsageSummary = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type KiroStreamState = {
  endDetected: boolean;
  finishEmitted: boolean;
  startEmitted: boolean;
  stopSeen: boolean;
  hasToolCalls: boolean;
  toolCallIndex: number;
  seenToolIds: Map<string, number>;
  toolArgsEmitted: Map<string, string>;
  toolArgsBuffered: Map<string, { toolIndex: number; canonical: string }>;
  generatedToolIdCounter: number;
  pendingWrapperToolCalls: Map<string, PendingKiroWrapperToolCall>;
  invalidToolCall?: boolean;
  totalContentLength?: number;
  contextUsagePercentage?: number;
  hasContextUsage?: boolean;
  hasMeteringEvent?: boolean;
  usage?: UsageSummary;
  hasReasoningContent?: boolean;
  reasoningChunkCount?: number;
  // Inline-thinking splitter state (populated only when thinkingExpected=true).
  thinking?: KiroThinkingState;
};

const KIRO_TOOL_CALL_WRAPPER = "tool_call";
const KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
const KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES_ENV = "KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES";
const KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS_ENV = "KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS";
const KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS_ENV = "KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS";
const KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS_ENV = "KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS";
const KIRO_TOOL_CALL_REPAIR_INSTRUCTION = [
  "Retry the previous response because its Kiro tool_call wrapper was malformed.",
  "If you use the wrapper tool named tool_call, its input must be a JSON object with a non-empty string name and an arguments field.",
  "Do not emit a tool_call wrapper without input.name and input.arguments.",
].join(" ");

type PendingKiroWrapperToolCall = {
  toolCallId: string;
  toolName: string;
  inputKind?: "string" | "object";
  inputText?: string;
  inputObject?: Record<string, unknown>;
};

function parseKiroToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== "string") return toolInput;
  try {
    return JSON.parse(toolInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Kiro tool_call payload: input must be valid JSON (${message})`);
  }
}

function validateKiroToolName(toolUse: JsonRecord): string {
  const toolName = typeof toolUse.name === "string" ? toolUse.name.trim() : "";
  if (!toolName) throw new Error("Invalid Kiro toolUseEvent: missing tool name");
  return toolName;
}

function validateKiroToolCallWrapperInput(toolInput: unknown): void {
  if (toolInput === undefined) {
    throw new Error("Invalid Kiro tool_call payload: missing input");
  }
  const input = parseKiroToolInput(toolInput);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      "Invalid Kiro tool_call payload: input must be an object with name and arguments"
    );
  }
  const record = input as JsonRecord;
  if (typeof record.name !== "string" || !record.name.trim()) {
    throw new Error("Invalid Kiro tool_call payload: missing nested MCP tool name at input.name");
  }
  if (!Object.prototype.hasOwnProperty.call(record, "arguments")) {
    throw new Error(
      "Invalid Kiro tool_call payload: missing nested MCP tool arguments at input.arguments"
    );
  }
}

export function validateKiroToolUse(toolUse: JsonRecord): void {
  const toolName = validateKiroToolName(toolUse);
  if (toolName === KIRO_TOOL_CALL_WRAPPER) {
    validateKiroToolCallWrapperInput(toolUse.input);
  }
}

function appendBufferedKiroToolInput(
  toolCall: PendingKiroWrapperToolCall,
  toolInput: unknown
): void {
  if (toolInput === undefined) return;
  if (typeof toolInput === "string") {
    if (toolCall.inputKind && toolCall.inputKind !== "string") {
      throw new Error("Invalid Kiro tool_call payload: mixed input fragment types");
    }
    toolCall.inputKind = "string";
    toolCall.inputText = `${toolCall.inputText || ""}${toolInput}`;
    return;
  }
  if (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)) {
    if (toolCall.inputKind && toolCall.inputKind !== "object") {
      throw new Error("Invalid Kiro tool_call payload: mixed input fragment types");
    }
    toolCall.inputKind = "object";
    toolCall.inputObject = toolInput as Record<string, unknown>;
  }
}

function getBufferedKiroToolInput(toolCall: PendingKiroWrapperToolCall): unknown {
  return toolCall.inputKind === "string" ? toolCall.inputText || "" : toolCall.inputObject;
}

function encodeSse(value: string): Uint8Array {
  return TEXT_ENCODER.encode(value);
}

function readPositiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function makeKiroAbortError(reason: unknown): Error {
  const error = new Error(typeof reason === "string" ? reason : "Request aborted");
  error.name = "AbortError";
  return error;
}

function combineKiroAbortSignals(signals: Array<AbortSignal | null | undefined>): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) return { cleanup: () => {} };
  if (activeSignals.length === 1) return { signal: activeSignals[0], cleanup: () => {} };

  const controller = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push([signal, listener]);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    },
  };
}

function throwIfKiroAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw makeKiroAbortError(signal.reason);
}

async function readKiroWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfKiroAborted(signal);
  let abortListener: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => reject(makeKiroAbortError(signal?.reason));
    signal?.addEventListener("abort", abortListener, { once: true });
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([reader.read(), abortPromise, timeoutPromise]);
  } finally {
    if (abortListener) signal?.removeEventListener("abort", abortListener);
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function concatKiroChunks(chunks: Uint8Array[]): Uint8Array {
  const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isMeaningfulKiroSseChunk(chunk: Uint8Array): boolean {
  const text = new TextDecoder().decode(chunk);
  return text.split("\n").some((line) => {
    if (!line.startsWith("data: ")) return false;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") return false;
    try {
      const parsed = JSON.parse(data) as JsonRecord;
      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const delta = (choices[0] as JsonRecord | undefined)?.delta;
      if (delta && typeof delta === "object") {
        const keys = Object.keys(delta as JsonRecord);
        if (keys.length === 1 && keys[0] === "role") return false;
      }
    } catch {
      // Non-JSON data is still visible output and therefore meaningful.
    }
    return true;
  });
}

function buildKiroToolCallRepairBody(body: unknown, invalidMessage: string): unknown {
  const repaired = JSON.parse(JSON.stringify(body ?? {})) as JsonRecord;
  const reason = String(invalidMessage || "invalid tool_call payload").slice(0, 300);
  const instruction = `${KIRO_TOOL_CALL_REPAIR_INSTRUCTION} Previous validation error: ${reason}`;
  if (typeof repaired.systemPrompt === "string" && repaired.systemPrompt.trim()) {
    repaired.systemPrompt = `${repaired.systemPrompt}\n\n${instruction}`;
  } else {
    repaired.systemPrompt = instruction;
  }

  const conversationState = repaired.conversationState as JsonRecord | undefined;
  const currentMessage = conversationState?.currentMessage as JsonRecord | undefined;
  const userInputMessage = currentMessage?.userInputMessage as JsonRecord | undefined;
  if (userInputMessage && typeof userInputMessage.content === "string") {
    userInputMessage.content = `${userInputMessage.content}\n\n${instruction}`;
  }
  return repaired;
}

function prependKiroChunkToReader(
  firstChunk: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: { onCancel?: (reason: unknown) => void; onDone?: () => void } = {}
): ReadableStream<Uint8Array> {
  let cancelled = false;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    options.onDone?.();
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (firstChunk.byteLength > 0) controller.enqueue(firstChunk);
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!cancelled) controller.enqueue(value);
        }
        if (!cancelled) controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      } finally {
        finish();
      }
    },
    async cancel(reason) {
      cancelled = true;
      options.onCancel?.(reason);
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
}

/**
 * Flush buffered tool arguments at finish boundaries.
 *
 * Kiro/CodeWhisperer streams toolUseEvent.input as PARTIAL OBJECTS that grow over time
 * (e.g. {command:"cat /home"} then {command:"cat /home/wxsys"}). Re-stringifying each one
 * and emitting it as an OpenAI argument delta produces overlapping prefixes that
 * concatenate into unparseable garbage downstream ("Unterminated string").
 *
 * Fix: defer object-form payloads into state.toolArgsBuffered keyed by toolCallId, keep
 * only the latest canonical, and emit ONCE here as the complete arguments string (the
 * final object is the source of truth — intermediate states are noise). String-form
 * payloads are already concatenable deltas and are emitted incrementally.
 */
export function flushBufferedToolArgs(
  state: Pick<KiroStreamState, "toolArgsBuffered" | "toolArgsEmitted">,
  controller: { enqueue: (chunk: Uint8Array) => void },
  ctx: { responseId: string; created: number; model: string }
): void {
  if (!state.toolArgsBuffered || state.toolArgsBuffered.size === 0) return;
  const { responseId, created, model } = ctx;
  for (const [toolCallId, info] of state.toolArgsBuffered) {
    const alreadyEmitted = state.toolArgsEmitted.get(toolCallId) || "";
    if (info.canonical && info.canonical !== alreadyEmitted) {
      const argsChunk: JsonRecord = {
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: info.toolIndex,
                  function: { arguments: info.canonical },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(argsChunk)}\n\n`));
      state.toolArgsEmitted.set(toolCallId, info.canonical);
    }
  }
  state.toolArgsBuffered.clear();
}

function buildKiroFinishChunk(
  state: KiroStreamState,
  responseId: string,
  created: number,
  model: string,
  includeUsage: boolean
): JsonRecord {
  const finishChunk: JsonRecord = {
    id: responseId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: state.hasToolCalls ? "tool_calls" : "stop",
      },
    ],
  };

  if (includeUsage && state.usage) {
    finishChunk.usage = state.usage;
  }

  return finishChunk;
}

function ensureKiroUsage(state: KiroStreamState) {
  if (state.usage) return;

  const estimatedOutputTokens =
    state.totalContentLength && state.totalContentLength > 0
      ? Math.max(1, Math.floor(state.totalContentLength / 4))
      : 0;

  const estimatedInputTokens =
    state.contextUsagePercentage && state.contextUsagePercentage > 0
      ? Math.floor((state.contextUsagePercentage * 200000) / 100)
      : 0;

  if (estimatedInputTokens <= 0 && estimatedOutputTokens <= 0) return;

  state.usage = {
    prompt_tokens: estimatedInputTokens,
    completion_tokens: estimatedOutputTokens,
    total_tokens: estimatedInputTokens + estimatedOutputTokens,
  };
}

/**
 * Resolve the RUNTIME AWS region for a Kiro/CodeWhisperer connection.
 *
 * The runtime region is the region of the Amazon Q Developer profile (embedded in the
 * profileArn — always us-east-1 or eu-central-1), NOT the IAM Identity Center / OIDC token
 * region. An enterprise IdC instance may live in eu-north-1 (or any region), but the Q Developer
 * profile that serves generateAssistantResponse only exists in us-east-1 / eu-central-1, so a
 * runtime call must target the profileArn's region — routing to q.{idcRegion}.amazonaws.com
 * (a host that does not exist) is what caused "no limits + 502 on every request". Delegates to
 * the shared resolver (profileArn region → valid stored profile region → us-east-1). The IdC
 * token region is used only for oidc.{region} token mint/refresh, elsewhere.
 */
export function resolveKiroRegion(
  credentials: { providerSpecificData?: unknown } | null | undefined
): string {
  return resolveKiroRuntimeRegion(
    (credentials?.providerSpecificData || {}) as { region?: unknown; profileArn?: unknown }
  );
}

// Re-exported from the shared region module so existing importers (and tests) that pull
// kiroRuntimeHost from this executor keep working.
export { kiroRuntimeHost };

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor(providerId = "kiro") {
    super(providerId, PROVIDERS[providerId] || PROVIDERS.kiro);
  }

  buildHeaders(credentials: ProviderCredentials, stream = true) {
    void stream;
    const headers = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": uuidv4(),
      "x-amzn-bedrock-cache-control": "enable",
      "anthropic-beta": "prompt-caching-2024-07-31",
    };

    const authMethod =
      typeof credentials.providerSpecificData?.authMethod === "string"
        ? credentials.providerSpecificData.authMethod
        : undefined;
    const isApiKey = authMethod === "api_key";
    const token = isApiKey
      ? credentials.apiKey || credentials.accessToken
      : credentials.accessToken;

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      // Long-lived Kiro/CodeWhisperer API keys authenticate with `tokentype: API_KEY`.
      if (isApiKey) headers["tokentype"] = "API_KEY";

      // Enterprise / Microsoft Entra "Your organization" (external_idp) logins send an
      // org-IdP-issued access token. CodeWhisperer only binds it to the Amazon Q Developer
      // profile when the request carries `TokenType: EXTERNAL_IDP`; without it every call
      // returns `ValidationException: Invalid ARN <clientId>` (the service falls back to the
      // token's client id as the resource ARN). AWS SSO (Builder ID / IDC) and social tokens
      // must NOT send this header, so it is gated on the persisted authMethod.
      if (isExternalIdpAuthMethod(authMethod)) {
        headers[KIRO_EXTERNAL_IDP_TOKEN_TYPE_HEADER] = KIRO_EXTERNAL_IDP_TOKEN_TYPE_VALUE;
      }
    }

    return headers;
  }

  transformRequest(model: string, body: unknown, stream: boolean, credentials: unknown): unknown {
    void stream;
    void credentials;
    const b = body as Record<string, unknown>;

    // Kiro API is strict and rejects any unknown top-level fields (like 'tools', 'stream', 'model', etc.)
    // We only preserve the fields specifically built by the openai-to-kiro translator.
    const kiroPayload: Record<string, unknown> = {};
    if (b.conversationState !== undefined) kiroPayload.conversationState = b.conversationState;
    if (b.profileArn !== undefined) kiroPayload.profileArn = b.profileArn;
    if (b.inferenceConfig !== undefined) kiroPayload.inferenceConfig = b.inferenceConfig;
    // Thinking control: `additionalModelRequestFields` ({output_config.effort,
    // thinking:{type:"adaptive"}, max_tokens}) is a recognized top-level field on
    // GenerateAssistantResponse — it steers adaptive reasoning. Built by the
    // openai-to-kiro translator only when the request asked for thinking.
    if (b.additionalModelRequestFields !== undefined)
      kiroPayload.additionalModelRequestFields = b.additionalModelRequestFields;

    // Fallback: if somehow conversationState isn't there, return the rest without model
    // (for backward compatibility if something else bypasses the translator)
    if (!kiroPayload.conversationState) {
      const { model: _model, ...rest } = b;
      return rest;
    }

    return kiroPayload;
  }

  /**
   * Custom execute for Kiro - handles AWS EventStream binary response
   */
  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    upstreamExtraHeaders,
  }: ExecuteInput) {
    // Route to the region-specific CodeWhisperer/Amazon Q endpoint. Enterprise IAM Identity
    // Center accounts (e.g. eu-central-1) are rejected by the default us-east-1 host; only the
    // regional endpoint accepts the region-bound token + profileArn.
    const region = resolveKiroRegion(credentials);
    const url = `${kiroRuntimeHost(region)}/generateAssistantResponse`;
    const headers = this.buildHeaders(credentials, stream);
    mergeUpstreamExtraHeaders(headers, upstreamExtraHeaders);
    const transformedBody = await this.transformRequest(model, body, stream, credentials);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    });

    if (!response.ok) {
      return { response, url, headers, transformedBody };
    }

    if (stream === false) {
      return {
        response: this.transformEventStreamToSSE(response, model),
        url,
        headers,
        transformedBody,
      };
    }

    return this.createToolCallRepairResult(
      { response, url, headers, transformedBody },
      {
        model,
        body,
        stream,
        credentials,
        signal,
        log,
        upstreamExtraHeaders,
        url,
        headers,
        transformedBody,
      }
    );
  }

  private async executeKiroAttempt(args: {
    model: string;
    body: unknown;
    stream: boolean;
    credentials: ProviderCredentials;
    signal?: AbortSignal | null;
    upstreamExtraHeaders?: Record<string, string> | null;
  }) {
    const region = resolveKiroRegion(args.credentials);
    const url = `${kiroRuntimeHost(region)}/generateAssistantResponse`;
    const headers = this.buildHeaders(args.credentials, args.stream);
    mergeUpstreamExtraHeaders(headers, args.upstreamExtraHeaders);
    const transformedBody = await this.transformRequest(
      args.model,
      args.body,
      args.stream,
      args.credentials
    );
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal: args.signal,
    });
    if (!response.ok) return { response, url, headers, transformedBody };

    return {
      response,
      url,
      headers,
      transformedBody,
    };
  }

  private async createToolCallRepairResult(
    firstResult: {
      response: Response;
      url: string;
      headers: Record<string, string>;
      transformedBody: unknown;
    },
    args: {
      model: string;
      body: unknown;
      stream: boolean;
      credentials: ProviderCredentials;
      signal?: AbortSignal | null;
      log?: ExecutorLog | null;
      upstreamExtraHeaders?: Record<string, string> | null;
      url: string;
      headers: Record<string, string>;
      transformedBody: unknown;
    }
  ) {
    const repairController = new AbortController();
    const combined = combineKiroAbortSignals([args.signal, repairController.signal]);
    let keepCleanup = false;
    const legacyTimeoutMs = readPositiveEnvInt(
      KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS_ENV,
      STREAM_READINESS_TIMEOUT_MS
    );
    const options: KiroRepairGateOptions = {
      signal: combined.signal,
      thinkingExpected: this.isKiroThinkingExpected(firstResult.transformedBody),
      maxBufferBytes: readPositiveEnvInt(
        KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES_ENV,
        KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES
      ),
      ttftTimeoutMs: readPositiveEnvInt(KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS_ENV, legacyTimeoutMs),
      stallTimeoutMs: readPositiveEnvInt(
        KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS_ENV,
        legacyTimeoutMs
      ),
      suppressInvalidToolCallError: true,
    };

    try {
      const firstAttempt = await this.openToolCallRepairGate(firstResult.response, args, options);
      if (firstAttempt.kind === "stream") {
        keepCleanup = true;
        firstResult.response = new Response(
          prependKiroChunkToReader(firstAttempt.firstChunk, firstAttempt.reader, {
            onCancel: (reason) => repairController.abort(reason),
            onDone: combined.cleanup,
          }),
          {
            status: firstResult.response.status,
            statusText: firstResult.response.statusText,
            headers: firstResult.response.headers,
          }
        );
        return firstResult;
      }
      if (firstAttempt.kind === "complete") {
        firstResult.response = new Response(firstAttempt.bytes, {
          status: firstResult.response.status,
          statusText: firstResult.response.statusText,
          headers: firstResult.response.headers,
        });
        return firstResult;
      }
      if (firstAttempt.kind === "buffer_exceeded") {
        firstResult.response = this.createKiroRepairErrorResponse(
          firstResult.response,
          `Kiro tool_call repair buffer exceeded ${options.maxBufferBytes} bytes`,
          "kiro_tool_call_repair_buffer_exceeded"
        );
        return firstResult;
      }

      const retryBody = buildKiroToolCallRepairBody(args.body, firstAttempt.invalidToolCall);
      const retryResult = await this.executeKiroAttempt({
        ...args,
        body: retryBody,
        signal: combined.signal,
      });
      if (!retryResult.response.ok) return retryResult;

      const retryAttempt = await this.openToolCallRepairGate(retryResult.response, args, {
        ...options,
        thinkingExpected: this.isKiroThinkingExpected(retryResult.transformedBody),
        suppressInvalidToolCallError: false,
        invalidToolCallErrorCode: "kiro_tool_call_repair_retry_failed",
      });
      if (retryAttempt.kind === "stream") {
        keepCleanup = true;
        retryResult.response = new Response(
          prependKiroChunkToReader(retryAttempt.firstChunk, retryAttempt.reader, {
            onCancel: (reason) => repairController.abort(reason),
            onDone: combined.cleanup,
          }),
          {
            status: retryResult.response.status,
            statusText: retryResult.response.statusText,
            headers: retryResult.response.headers,
          }
        );
        return retryResult;
      }
      if (retryAttempt.kind === "complete") {
        retryResult.response = new Response(retryAttempt.bytes, {
          status: retryResult.response.status,
          statusText: retryResult.response.statusText,
          headers: retryResult.response.headers,
        });
        return retryResult;
      }

      retryResult.response = this.createKiroRepairErrorResponse(
        retryResult.response,
        retryAttempt.kind === "buffer_exceeded"
          ? `Kiro tool_call repair buffer exceeded ${options.maxBufferBytes} bytes`
          : retryAttempt.invalidToolCall || "Kiro tool_call repair retry failed",
        retryAttempt.kind === "buffer_exceeded"
          ? "kiro_tool_call_repair_buffer_exceeded"
          : "kiro_tool_call_repair_retry_failed"
      );
      return retryResult;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      firstResult.response = this.createKiroRepairErrorResponse(
        firstResult.response,
        error instanceof Error ? error.message : String(error),
        "kiro_tool_call_repair_failed"
      );
      return firstResult;
    } finally {
      if (!keepCleanup) combined.cleanup();
    }
  }

  private createKiroRepairErrorResponse(
    response: Response,
    message: string,
    code: string
  ): Response {
    const safeMessage = sanitizeErrorMessage(message);
    return new Response(
      encodeSse(
        `data: ${JSON.stringify({ error: { message: safeMessage, type: "invalid_request_error", code } })}\n\ndata: [DONE]\n\n`
      ),
      {
        status: response.status,
        statusText: response.statusText,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      }
    );
  }

  private isKiroThinkingExpected(transformedBody: unknown): boolean {
    const body = transformedBody as Record<string, unknown>;
    const currentMessage = (body?.conversationState as Record<string, unknown> | undefined)
      ?.currentMessage as Record<string, unknown> | undefined;
    const userInputMessage = currentMessage?.userInputMessage as
      Record<string, unknown> | undefined;
    return (
      typeof userInputMessage?.content === "string" &&
      userInputMessage.content.includes("<thinking_mode>enabled</thinking_mode>")
    );
  }

  async openToolCallRepairGate(
    rawResponse: Response,
    args: { model: string },
    options: KiroRepairGateOptions
  ): Promise<KiroRepairGateResult> {
    let invalidToolCall: string | undefined;
    const transformed = this.transformEventStreamToSSE(rawResponse, args.model, {
      thinkingExpected: options.thinkingExpected,
      onInvalidToolCall: (message) => {
        invalidToolCall = message;
      },
      suppressInvalidToolCallError: options.suppressInvalidToolCallError,
      invalidToolCallErrorCode: options.invalidToolCallErrorCode,
    });
    if (!transformed.body) return { kind: "complete", bytes: new Uint8Array() };
    const reader = transformed.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let sawChunk = false;

    try {
      while (true) {
        const timeoutMs = sawChunk ? options.stallTimeoutMs : options.ttftTimeoutMs;
        const timeoutKind = sawChunk ? "stalled" : "timed out before first chunk";
        const result = await readKiroWithTimeout(
          reader,
          options.signal,
          timeoutMs,
          `Kiro tool_call repair ${timeoutKind}`
        );
        if (result.done) {
          if (invalidToolCall) return { kind: "invalid", invalidToolCall };
          return { kind: "complete", bytes: concatKiroChunks(chunks) };
        }
        sawChunk = true;
        if (invalidToolCall) {
          // The transform terminates its readable side and cancels the raw upstream
          // body when validation fails. Calling reader.cancel() again here can race
          // Node's TransformStream termination and mask the validation error.
          return { kind: "invalid", invalidToolCall };
        }
        totalBytes += result.value.byteLength;
        if (totalBytes > options.maxBufferBytes) {
          await reader.cancel("kiro_tool_call_repair_buffer_exceeded").catch(() => {});
          return { kind: "buffer_exceeded" };
        }
        if (isMeaningfulKiroSseChunk(result.value)) {
          return { kind: "stream", firstChunk: result.value, reader };
        }
        chunks.push(result.value);
      }
    } catch (error) {
      await reader.cancel(error instanceof Error ? error.message : String(error)).catch(() => {});
      throw error;
    }
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream.
   * Using TransformStream instead of ReadableStream.pull() to avoid Workers timeout.
   *
   * @param response        Upstream raw fetch response (binary EventStream).
   * @param model           Logical model id (kept in OpenAI chunks for clients).
   * @param opts
   * @param opts.thinkingExpected  When true, scan inbound
   *   `assistantResponseEvent.content` for inline `<thinking>…</thinking>`
   *   blocks and split them into the OpenAI `delta.reasoning_content` channel.
   *   Required for Claude on Kiro when `<thinking_mode>enabled</thinking_mode>`
   *   is in the system prompt, because Kiro streams reasoning inline rather
   *   than as separate `reasoningContentEvent` frames.
   */
  transformEventStreamToSSE(
    response: Response,
    model: string,
    opts: {
      thinkingExpected?: boolean;
      onInvalidToolCall?: (message: string) => void;
      suppressInvalidToolCallError?: boolean;
      invalidToolCallErrorCode?: string;
    } = {}
  ) {
    const thinkingExpected = !!opts.thinkingExpected;
    const buffer = new ByteQueue();
    let chunkIndex = 0;
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const state: KiroStreamState = {
      endDetected: false,
      finishEmitted: false,
      startEmitted: false,
      stopSeen: false,
      hasToolCalls: false,
      toolCallIndex: 0,
      seenToolIds: new Map(),
      toolArgsEmitted: new Map(),
      toolArgsBuffered: new Map(),
      generatedToolIdCounter: 0,
      pendingWrapperToolCalls: new Map(),
      hasReasoningContent: false,
      reasoningChunkCount: 0,
      thinking: thinkingExpected ? { thinkingMode: false, pendingTag: "" } : undefined,
    };

    const getToolCallId = (toolUse: JsonRecord): string => {
      if (typeof toolUse.toolUseId === "string" && toolUse.toolUseId) {
        return toolUse.toolUseId;
      }
      state.generatedToolIdCounter += 1;
      return `call_${created}_${state.generatedToolIdCounter}`;
    };

    const emitToolCallStart = (
      controller: TransformStreamDefaultController,
      toolCallId: string,
      toolName: string,
      toolIndex: number
    ) => {
      const startChunk: JsonRecord = {
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              ...(chunkIndex === 0 ? { role: "assistant" } : {}),
              tool_calls: [
                {
                  index: toolIndex,
                  id: toolCallId,
                  type: "function",
                  function: { name: toolName, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      chunkIndex += 1;
      controller.enqueue(encodeSse(`data: ${JSON.stringify(startChunk)}\n\n`));
    };

    const emitToolCallArguments = (
      controller: TransformStreamDefaultController,
      toolIndex: number,
      argumentsStr: string
    ) => {
      const argsChunk: JsonRecord = {
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: toolIndex, function: { arguments: argumentsStr } }],
            },
            finish_reason: null,
          },
        ],
      };
      chunkIndex += 1;
      controller.enqueue(encodeSse(`data: ${JSON.stringify(argsChunk)}\n\n`));
    };

    const failInvalidToolCall = (controller: TransformStreamDefaultController, message: string) => {
      const error = {
        error: {
          message,
          type: "invalid_request_error",
          code: opts.invalidToolCallErrorCode || "invalid_kiro_tool_call",
        },
      };
      state.invalidToolCall = true;
      state.finishEmitted = true;
      opts.onInvalidToolCall?.(message);
      if (!opts.suppressInvalidToolCallError) {
        controller.enqueue(encodeSse(`data: ${JSON.stringify(error)}\n\n`));
        controller.enqueue(encodeSse("data: [DONE]\n\n"));
      }
      controller.terminate();
    };

    const flushPendingWrapperToolCalls = (
      controller: TransformStreamDefaultController
    ): boolean => {
      for (const toolCall of state.pendingWrapperToolCalls.values()) {
        const toolInput = getBufferedKiroToolInput(toolCall);
        try {
          validateKiroToolCallWrapperInput(toolInput);
        } catch (error) {
          failInvalidToolCall(controller, error instanceof Error ? error.message : String(error));
          return false;
        }

        const toolIndex = state.toolCallIndex++;
        state.seenToolIds.set(toolCall.toolCallId, toolIndex);
        emitToolCallStart(controller, toolCall.toolCallId, toolCall.toolName, toolIndex);
        const argumentsStr =
          typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput ?? {});
        if (argumentsStr) emitToolCallArguments(controller, toolIndex, argumentsStr);
      }
      state.pendingWrapperToolCalls.clear();
      return true;
    };

    const transformStream = new TransformStream(
      {
        async transform(chunk, controller) {
          buffer.push(chunk);

          // Parse events from buffer
          let iterations = 0;
          const maxIterations = 1000;
          while (buffer.length >= 16 && iterations < maxIterations) {
            iterations++;
            const totalLength = buffer.peekUint32BE(0);

            if (!totalLength || totalLength < 16 || totalLength > buffer.length) break;

            const eventData = buffer.read(totalLength);
            if (!eventData) break;

            const event = parseEventFrame(eventData);
            if (!event) continue;

            // Emit a role-only start chunk on the FIRST successfully-parsed AWS
            // EventStream frame. CodeWhisperer sends framing/metadata events before
            // the first content token, and on large/agentic contexts the gap before
            // that first `assistantResponseEvent` can be many seconds. The backend
            // stream-readiness gate (ensureStreamReadiness) holds the ENTIRE response
            // from the client until it observes a useful SSE frame, so without an
            // early frame the client sees a frozen connection for that whole window
            // (up to STREAM_READINESS_TIMEOUT_MS — 180s as configured by VibeProxy),
            // then a burst — the "minutes instead of seconds, not streaming" symptom.
            // A role-only `chat.completion.chunk` is a non-ping structured payload, so
            // it satisfies hasStreamReadinessSignal and hands the stream off
            // immediately. Mirrors the early lifecycle frame other executors already
            // emit (Claude message_start / OpenAI response.created). The downstream
            // idle timeout still guards genuine post-start stalls.
            if (!state.startEmitted) {
              state.startEmitted = true;
              const startChunk: JsonRecord = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant" },
                    finish_reason: null,
                  },
                ],
              };
              chunkIndex++;
              controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(startChunk)}\n\n`));
            }

            const eventType = event.headers[":event-type"] || "";

            // Track total content length for token estimation
            if (!state.totalContentLength) state.totalContentLength = 0;
            if (!state.contextUsagePercentage) state.contextUsagePercentage = 0;

            // Native reasoning frames. Verified against the live CodeWhisperer
            // stream (2026-07): with adaptive thinking enabled (via
            // additionalModelRequestFields), Kiro streams reasoning as a dedicated
            // `reasoningContentEvent` frame carrying `{ text, signature }` — NOT
            // inline `<thinking>` tags and NOT `assistantResponseEvent`. Some
            // models/variants instead use a `reasoningText` object or a flat
            // `{ text }` (cf. javargasm/pi-kiro `src/event-parser.ts`). OmniRoute
            // had no handler for this event, so the reasoning was silently dropped;
            // route it to the OpenAI `reasoning_content` channel.
            {
              const rp = event.payload as Record<string, unknown> | undefined;
              const rt = rp?.reasoningText;
              if (eventType === "reasoningContentEvent" || rt !== undefined) {
                let nativeReasoning = "";
                if (rt && typeof rt === "object") {
                  const rto = rt as { text?: unknown; Text?: unknown };
                  nativeReasoning =
                    typeof rto.text === "string"
                      ? rto.text
                      : typeof rto.Text === "string"
                        ? rto.Text
                        : "";
                } else if (typeof rt === "string") {
                  nativeReasoning = rt;
                } else if (typeof rp?.text === "string") {
                  nativeReasoning = rp.text as string;
                }
                if (nativeReasoning) {
                  state.hasReasoningContent = true;
                  const reasoningDelta: JsonRecord =
                    (state.reasoningChunkCount ?? 0) === 0 && chunkIndex === 0
                      ? { role: "assistant", reasoning_content: nativeReasoning }
                      : { reasoning_content: nativeReasoning };
                  const chunk: JsonRecord = {
                    id: responseId,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    choices: [{ index: 0, delta: reasoningDelta, finish_reason: null }],
                  };
                  chunkIndex++;
                  state.reasoningChunkCount = (state.reasoningChunkCount ?? 0) + 1;
                  controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
                // Consume the reasoning frame (incl. signature-only) so it never
                // falls through to the content handlers below.
                continue;
              }
            }

            // Handle assistantResponseEvent
            if (eventType === "assistantResponseEvent") {
              const content =
                typeof event.payload?.content === "string" ? event.payload.content : "";
              if (!content) {
                continue;
              }
              state.totalContentLength += content.length;

              if (thinkingExpected && state.thinking) {
                // Claude on Kiro emits reasoning inline as `<thinking>…</thinking>`
                // when `<thinking_mode>enabled</thinking_mode>` is in the system prompt.
                // Split it into the OpenAI `reasoning_content` channel so downstream
                // consumers see the same shape they would get from a native reasoning model.
                const thinkingState = state.thinking;
                splitInlineThinking(
                  thinkingState,
                  content,
                  (text) => {
                    if (!text) return;
                    const chunk: JsonRecord = {
                      id: responseId,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta:
                            chunkIndex === 0
                              ? { role: "assistant", content: text }
                              : { content: text },
                          finish_reason: null,
                        },
                      ],
                    };
                    chunkIndex++;
                    controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  },
                  (reasoning) => {
                    if (!reasoning) return;
                    state.hasReasoningContent = true;
                    const reasoningDelta: JsonRecord =
                      (state.reasoningChunkCount ?? 0) === 0 && chunkIndex === 0
                        ? { role: "assistant", reasoning_content: reasoning }
                        : { reasoning_content: reasoning };
                    const chunk: JsonRecord = {
                      id: responseId,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: reasoningDelta,
                          finish_reason: null,
                        },
                      ],
                    };
                    chunkIndex++;
                    state.reasoningChunkCount = (state.reasoningChunkCount ?? 0) + 1;
                    controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                );
              } else {
                const chunk: JsonRecord = {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: chunkIndex === 0 ? { role: "assistant", content } : { content },
                      finish_reason: null,
                    },
                  ],
                };
                chunkIndex++;
                controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            }

            // Handle codeEvent
            if (eventType === "codeEvent" && event.payload?.content) {
              const chunk: JsonRecord = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: event.payload.content },
                    finish_reason: null,
                  },
                ],
              };
              chunkIndex++;
              controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

            // Handle toolUseEvent
            if (eventType === "toolUseEvent" && event.payload) {
              state.hasToolCalls = true;
              const toolUse = event.payload;
              const toolUses = Array.isArray(toolUse) ? toolUse : [toolUse];

              for (const rawToolUse of toolUses) {
                const singleToolUse = rawToolUse as JsonRecord;
                let toolName: string;
                try {
                  toolName = validateKiroToolName(singleToolUse);
                } catch (error) {
                  failInvalidToolCall(
                    controller,
                    error instanceof Error ? error.message : String(error)
                  );
                  return;
                }

                const toolCallId = getToolCallId(singleToolUse);
                const toolInput = singleToolUse.input;

                if (toolName === KIRO_TOOL_CALL_WRAPPER) {
                  let pending = state.pendingWrapperToolCalls.get(toolCallId);
                  if (!pending) {
                    if (state.seenToolIds.has(toolCallId)) {
                      failInvalidToolCall(
                        controller,
                        "Invalid Kiro tool_call payload: duplicate toolUseId reused by wrapper"
                      );
                      return;
                    }
                    pending = { toolCallId, toolName };
                    state.pendingWrapperToolCalls.set(toolCallId, pending);
                  }
                  try {
                    appendBufferedKiroToolInput(pending, toolInput);
                  } catch (error) {
                    failInvalidToolCall(
                      controller,
                      error instanceof Error ? error.message : String(error)
                    );
                    return;
                  }
                  continue;
                }

                if (state.pendingWrapperToolCalls.has(toolCallId)) {
                  failInvalidToolCall(
                    controller,
                    "Invalid Kiro tool_call payload: mixed wrapper and direct tool fragments"
                  );
                  return;
                }

                let toolIndex;
                const isNewTool = !state.seenToolIds.has(toolCallId);

                if (isNewTool) {
                  toolIndex = state.toolCallIndex++;
                  state.seenToolIds.set(toolCallId, toolIndex);
                  emitToolCallStart(controller, toolCallId, toolName, toolIndex);
                } else {
                  toolIndex = state.seenToolIds.get(toolCallId) as number;
                }

                if (toolInput !== undefined) {
                  if (typeof toolInput === "string") {
                    // String-form payloads are already concatenable incremental deltas —
                    // emit immediately and track what we've sent.
                    state.toolArgsEmitted.set(
                      toolCallId,
                      (state.toolArgsEmitted.get(toolCallId) || "") + toolInput
                    );

                    const argsChunk = {
                      id: responseId,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: toolIndex,
                                function: {
                                  arguments: toolInput,
                                },
                              },
                            ],
                          },
                          finish_reason: null,
                        },
                      ],
                    };
                    chunkIndex++;
                    controller.enqueue(
                      TEXT_ENCODER.encode(`data: ${JSON.stringify(argsChunk)}\n\n`)
                    );
                  } else if (typeof toolInput === "object" && toolInput !== null) {
                    // Object-form payloads are PARTIAL OBJECTS that grow over time. Buffer
                    // the latest canonical and flush once at a finish boundary, otherwise the
                    // overlapping JSON prefixes concatenate into unparseable garbage.
                    state.toolArgsBuffered.set(toolCallId, {
                      toolIndex,
                      canonical: JSON.stringify(toolInput),
                    });
                  }
                }
              }
            }

            // Handle messageStopEvent
            if (eventType === "messageStopEvent") {
              if (!flushPendingWrapperToolCalls(controller)) return;
              flushBufferedToolArgs(state, controller, { responseId, created, model });
              state.stopSeen = true;
            }

            // Handle contextUsageEvent to extract contextUsagePercentage
            if (eventType === "contextUsageEvent") {
              const contextUsage =
                typeof event.payload?.contextUsagePercentage === "number"
                  ? event.payload.contextUsagePercentage
                  : 0;
              if (contextUsage <= 0) {
                continue;
              }
              state.contextUsagePercentage = contextUsage;
              // Mark that we received context usage event
              state.hasContextUsage = true;
            }

            // Handle meteringEvent - mark that we received it
            if (eventType === "meteringEvent") {
              state.hasMeteringEvent = true;
            }

            // Handle metricsEvent for token usage
            if (eventType === "metricsEvent") {
              // Extract usage data from metricsEvent payload
              const metrics = event.payload?.metricsEvent || event.payload;
              if (metrics && typeof metrics === "object") {
                const inputTokens =
                  typeof (metrics as JsonRecord).inputTokens === "number"
                    ? ((metrics as JsonRecord).inputTokens as number)
                    : 0;
                const outputTokens =
                  typeof (metrics as JsonRecord).outputTokens === "number"
                    ? ((metrics as JsonRecord).outputTokens as number)
                    : 0;

                const cacheReadTokens =
                  typeof (metrics as JsonRecord).cacheReadTokens === "number"
                    ? ((metrics as JsonRecord).cacheReadTokens as number)
                    : 0;

                const cacheCreationTokens =
                  typeof (metrics as JsonRecord).cacheCreationTokens === "number"
                    ? ((metrics as JsonRecord).cacheCreationTokens as number)
                    : 0;

                if (inputTokens > 0 || outputTokens > 0) {
                  state.usage = {
                    prompt_tokens: inputTokens,
                    completion_tokens: outputTokens,
                    total_tokens: inputTokens + outputTokens,
                    ...(cacheReadTokens > 0 && { cache_read_input_tokens: cacheReadTokens }),
                    ...(cacheCreationTokens > 0 && {
                      cache_creation_input_tokens: cacheCreationTokens,
                    }),
                  };
                }
              }
            }
          }

          if (iterations >= maxIterations) {
            console.warn("[Kiro] Max iterations reached in event parsing");
          }
        },

        flush(controller) {
          if (!flushPendingWrapperToolCalls(controller)) return;
          if (state.invalidToolCall) return;
          // Flush any buffered tool arguments (partial-object payloads) before finishing —
          // idempotent against toolArgsEmitted if messageStopEvent already flushed them.
          flushBufferedToolArgs(state, controller, { responseId, created, model });

          // Drain any pending inline-thinking tag fragment so we don't drop
          // trailing characters when the stream ends mid-tag (e.g. `<thi`).
          if (thinkingExpected && state.thinking) {
            const thinkingState = state.thinking;
            flushPendingThinking(
              thinkingState,
              (text) => {
                if (!text) return;
                const chunk: JsonRecord = {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                };
                chunkIndex++;
                controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              },
              (reasoning) => {
                if (!reasoning) return;
                const chunk: JsonRecord = {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [
                    { index: 0, delta: { reasoning_content: reasoning }, finish_reason: null },
                  ],
                };
                chunkIndex++;
                controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            );
          }

          // Emit finish chunk if not already sent
          if (!state.finishEmitted) {
            state.finishEmitted = true;
            ensureKiroUsage(state);
            const finishChunk = buildKiroFinishChunk(state, responseId, created, model, true);
            controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          }

          // Send final done message
          controller.enqueue(TEXT_ENCODER.encode("data: [DONE]\n\n"));
        },
      },
      { highWaterMark: 16384 },
      { highWaterMark: 16384 }
    );

    // Pipe response body through transform stream
    const transformedStream = response.body.pipeThrough(transformStream);

    return new Response(transformedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  async refreshCredentials(credentials: ProviderCredentials, log?: ExecutorLog | null) {
    if (credentials.providerSpecificData?.authMethod === "api_key") return null;
    if (!credentials.refreshToken) return null;

    try {
      // Use centralized refreshKiroToken function (handles both AWS SSO OIDC and Social Auth)
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log
      );

      if (!result || result.error) return result;

      // If client was re-registered (expired/invalid clientId/clientSecret after DB import,
      // TTL expiry, or browser conflict), update providerSpecificData with new credentials (#2524).
      if (result._newClientId) {
        const updatedPsd = {
          ...(credentials.providerSpecificData || {}),
          clientId: result._newClientId,
          clientSecret: result._newClientSecret,
          clientSecretExpiresAt: result._newClientSecretExpiresAt,
        };
        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          providerSpecificData: updatedPsd,
        };
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log?.error?.("TOKEN", `Kiro refresh error: ${err.message}`);
      return null;
    }
  }
}

export default KiroExecutor;
