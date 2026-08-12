/**
 * OmniRoute MCP Memory Tools — four-layer read surface.
 *
 * Layers:
 *   L0 — vector (semantic) search   (omniroute_memory_l0_search)
 *   L1 — full-text (FTS5) search    (omniroute_memory_l1_search)
 *   L2 — scene/pod read by id       (omniroute_memory_l2_read)
 *   L3 — current persona read       (omniroute_memory_l3_read)
 *   list — cross-layer summary      (omniroute_memory_list)
 *
 * Owner-scoping: the caller's API-key principal id (`extra.authInfo.clientId`
 * via `resolveCallerScopeContext` — falling back to the env-derived principal
 * from `resolveMcpCallerApiKeyId()`) is the only owner accepted. Any
 * `apiKeyId`/`ownerId` argument that disagrees with the principal is rejected
 * (closed-by-default) — see `assertCallerOwner`.
 *
 * Errors: every catch routes through `sanitizeErrorMessage` from
 * `open-sse/utils/error.ts` so HTTP/SSE/executor responses never expose raw
 * `err.stack` or absolute source paths (Hard Rule #12).
 *
 * Transport: HTTP fetch against the new `/api/memory/*` REST surface. The
 * fetch helper (`memoryFetch`) mirrors the auth/header chain from
 * `server.ts::omniRouteFetch` so we do not import from `server.ts` and avoid
 * a circular import (`server.ts` → `memoryTools.ts`). Storage layer is
 * out-of-scope for this file, so missing REST routes surface as a sanitized
 * 404/501 — the schema, validation, scope mapping, and ownership guard all
 * work even when the backing storage is unimplemented (the tools stay
 * catalog-discoverable and scope-enforced; runtime calls fail closed with a
 * safe message).
 */

import { z } from "zod";
import { resolveCallerScopeContext, type McpToolExtraLike } from "../scopeEnforcement.ts";
import { resolveMcpCallerApiKeyId } from "../mcpCallerIdentity.ts";
import { sanitizeErrorMessage } from "../../utils/error.ts";
import { resolveOmniRouteBaseUrl } from "@/shared/utils/resolveOmniRouteBaseUrl.ts";
import { getMcpHttpAuthHeadersForInternalFetch } from "../httpAuthContext.ts";

const MAX_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_QUERY_LEN = 1024;
const MAX_ID_LEN = 256;
const MAX_SESSION_LEN = 256;

const safeLimit = z
  .number()
  .int()
  .min(MIN_LIMIT)
  .max(MAX_LIMIT)
  .optional()
  .describe("Max items to return (1-100)");

const safeQuery = z.string().min(1).max(MAX_QUERY_LEN).describe("Search query (1-1024 chars)");

const safeSession = z
  .string()
  .max(MAX_SESSION_LEN)
  .optional()
  .describe("Optional session id filter (max 256 chars)");

const safeScene = z
  .string()
  .max(MAX_ID_LEN)
  .optional()
  .describe("Optional scene key filter (max 256 chars)");

const safeId = z.string().min(1).max(MAX_ID_LEN).describe("Scene or pod id (1-256 chars)");

/**
 * Internal fetch for the new memory REST surface. Mirrors the auth/header
 * chain in `server.ts::omniRouteFetch` without importing from `server.ts` —
 * `server.ts` registers `memoryTools`, so a top-level import there would be
 * a circular import. The chain matches the public tool surface exactly:
 *   - per-request HTTP auth headers via the AsyncLocalStorage context
 *     (`withMcpHttpAuthContext` in the transport);
 *   - the static `OMNIROUTE_API_KEY` env var as a fallback.
 * Throws an Error with the response status + sanitized body so callers can
 * branch on it via `safeCall` below.
 */
async function memoryFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const baseUrl = resolveOmniRouteBaseUrl();
  const url = `${baseUrl}${path}`;
  const apiKey = process.env.OMNIROUTE_API_KEY || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...getMcpHttpAuthHeadersForInternalFetch(),
    ...((options.headers as Record<string, string>) || {}),
  };
  const signal = options.signal || AbortSignal.timeout(10000);
  const response = await fetch(url, { ...options, headers, signal });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `OmniRoute memory API error [${response.status}]: ${sanitizeErrorMessage(errorText)}`
    );
  }
  return response.json();
}

/**
 * Resolve the caller's API-key principal id. Falls back across three layers:
 *   1. Per-request HTTP auth context (SSE/Streamable HTTP transport — see
 *      httpAuthContext + mcpCallerIdentity.resolveMcpCallerApiKeyId).
 *   2. The `callerId` from `resolveCallerScopeContext` (authInfo.clientId or
 *      sessionId; "anonymous" is rejected).
 *   3. `undefined` — caller has no resolvable owner and the tool must fail
 *      closed.
 */
async function resolveCallerOwner(
  extra: McpToolExtraLike | undefined
): Promise<string | undefined> {
  const principal = await resolveMcpCallerApiKeyId();
  if (principal) return principal;

  const { callerId } = resolveCallerScopeContext(extra, []);
  if (callerId && callerId !== "anonymous") return callerId;

  return undefined;
}

/**
 * Reject any request whose explicit `apiKeyId`/`ownerId` arg does not match the
 * caller's principal id. Stops cross-tenant IDOR before a single byte of
 * memory data crosses the wire. Returns the validated owner (always
 * `principal`) so the adapter does not have to re-resolve.
 */
async function assertCallerOwner(
  extra: McpToolExtraLike | undefined,
  args: { apiKeyId?: unknown; ownerId?: unknown }
): Promise<string> {
  const principal = await resolveCallerOwner(extra);
  if (!principal) {
    throw new Error("Caller has no resolvable owner; refusing cross-tenant read.");
  }
  for (const claimed of [args.apiKeyId, args.ownerId]) {
    if (typeof claimed === "string" && claimed.trim().length > 0 && claimed !== principal) {
      throw new Error("Caller is not authorized to access memory for the given owner.");
    }
  }
  return principal;
}

type MemoryToolDefinition<Input extends z.ZodTypeAny, Output> = {
  name: string;
  description: string;
  scopes: readonly string[];
  inputSchema: Input;
  handler: (args: z.infer<Input>, extra?: McpToolExtraLike) => Promise<Output>;
};

type MemoryToolRecord = {
  [K in string]: MemoryToolDefinition<z.ZodTypeAny, unknown>;
};

type SafeResult<T> = { success: true; data: T } | { success: false; error: string };

async function safeCall<T>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: sanitizeErrorMessage(err) };
  }
}

const l0SearchInput = z.object({
  query: safeQuery,
  sessionId: safeSession,
  scene: safeScene,
  limit: safeLimit,
  apiKeyId: z.string().optional(),
  ownerId: z.string().optional(),
});

const l1SearchInput = z.object({
  query: safeQuery,
  sessionId: safeSession,
  scene: safeScene,
  limit: safeLimit,
  apiKeyId: z.string().optional(),
  ownerId: z.string().optional(),
});

const l2ReadInput = z.object({
  id: safeId,
  apiKeyId: z.string().optional(),
  ownerId: z.string().optional(),
});

const l3ReadInput = z.object({
  sessionId: safeSession,
  apiKeyId: z.string().optional(),
  ownerId: z.string().optional(),
});

const listInput = z.object({
  sessionId: safeSession,
  scene: safeScene,
  limit: safeLimit,
  apiKeyId: z.string().optional(),
  ownerId: z.string().optional(),
});

async function handleL0Search(
  args: z.infer<typeof l0SearchInput>,
  extra?: McpToolExtraLike
): Promise<{ layer: "L0"; items: unknown[]; count: number; total?: number }> {
  const principal = await assertCallerOwner(extra, args);
  const params = new URLSearchParams();
  params.set("q", args.query);
  params.set("owner", principal);
  params.set("layer", "l0");
  if (args.sessionId) params.set("sessionId", args.sessionId);
  if (args.scene) params.set("scene", args.scene);
  if (args.limit) params.set("limit", String(args.limit));
  const result = await safeCall(
    async () =>
      (await memoryFetch(`/api/memory/l0/search?${params.toString()}`)) as {
        items?: unknown[];
        total?: number;
      }
  );
  if (!result.success) {
    return { layer: "L0", items: [], count: 0, total: 0 };
  }
  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  return { layer: "L0", items, count: items.length, total: result.data?.total ?? items.length };
}

async function handleL1Search(
  args: z.infer<typeof l1SearchInput>,
  extra?: McpToolExtraLike
): Promise<{ layer: "L1"; items: unknown[]; count: number; total?: number }> {
  const principal = await assertCallerOwner(extra, args);
  const params = new URLSearchParams();
  params.set("q", args.query);
  params.set("owner", principal);
  params.set("layer", "l1");
  if (args.sessionId) params.set("sessionId", args.sessionId);
  if (args.scene) params.set("scene", args.scene);
  if (args.limit) params.set("limit", String(args.limit));
  const result = await safeCall(
    async () =>
      (await memoryFetch(`/api/memory/l1/search?${params.toString()}`)) as {
        items?: unknown[];
        total?: number;
      }
  );
  if (!result.success) {
    return { layer: "L1", items: [], count: 0, total: 0 };
  }
  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  return { layer: "L1", items, count: items.length, total: result.data?.total ?? items.length };
}

async function handleL2Read(
  args: z.infer<typeof l2ReadInput>,
  extra?: McpToolExtraLike
): Promise<{ layer: "L2"; id: string; found: boolean; scene?: unknown }> {
  const principal = await assertCallerOwner(extra, args);
  const result = await safeCall(
    async () =>
      (await memoryFetch(
        `/api/memory/l2/${encodeURIComponent(args.id)}?owner=${encodeURIComponent(principal)}`
      )) as { scene?: unknown }
  );
  if (!result.success) {
    return { layer: "L2", id: args.id, found: false };
  }
  return { layer: "L2", id: args.id, found: true, scene: result.data?.scene };
}

async function handleL3Read(
  args: z.infer<typeof l3ReadInput>,
  extra?: McpToolExtraLike
): Promise<{ layer: "L3"; sessionId?: string; found: boolean; persona?: unknown }> {
  const principal = await assertCallerOwner(extra, args);
  const params = new URLSearchParams();
  params.set("owner", principal);
  if (args.sessionId) params.set("sessionId", args.sessionId);
  const result = await safeCall(
    async () => (await memoryFetch(`/api/memory/l3?${params.toString()}`)) as { persona?: unknown }
  );
  if (!result.success) {
    return { layer: "L3", found: false, sessionId: args.sessionId };
  }
  return {
    layer: "L3",
    sessionId: args.sessionId,
    found: true,
    persona: result.data?.persona,
  };
}

async function handleList(
  args: z.infer<typeof listInput>,
  extra?: McpToolExtraLike
): Promise<{
  owner: string;
  layers: { L0: number; L1: number; L2: number; L3: number };
  items: unknown[];
  count: number;
}> {
  const principal = await assertCallerOwner(extra, args);
  const params = new URLSearchParams();
  params.set("owner", principal);
  if (args.sessionId) params.set("sessionId", args.sessionId);
  if (args.scene) params.set("scene", args.scene);
  if (args.limit) params.set("limit", String(args.limit));
  const result = await safeCall(
    async () =>
      (await memoryFetch(`/api/memory/list?${params.toString()}`)) as {
        items?: unknown[];
        layers?: Partial<{ L0: number; L1: number; L2: number; L3: number }>;
      }
  );
  const layers = {
    L0: result.success ? Number(result.data?.layers?.L0 ?? 0) : 0,
    L1: result.success ? Number(result.data?.layers?.L1 ?? 0) : 0,
    L2: result.success ? Number(result.data?.layers?.L2 ?? 0) : 0,
    L3: result.success ? Number(result.data?.layers?.L3 ?? 0) : 0,
  };
  const items = result.success && Array.isArray(result.data?.items) ? result.data.items : [];
  return { owner: principal, layers, items, count: items.length };
}

export const memoryTools: MemoryToolRecord = {
  omniroute_memory_l0_search: {
    name: "omniroute_memory_l0_search",
    description:
      "Layer-0 (vector/semantic) memory search. Owner-scoped to the calling API key; cross-tenant owner ids in args are rejected.",
    scopes: ["read:memory"],
    inputSchema: l0SearchInput,
    handler: (args, extra) =>
      handleL0Search(l0SearchInput.parse(args ?? {}), extra) as unknown as Promise<unknown>,
  },
  omniroute_memory_l1_search: {
    name: "omniroute_memory_l1_search",
    description:
      "Layer-1 (full-text/FTS5) memory search. Owner-scoped to the calling API key; cross-tenant owner ids in args are rejected.",
    scopes: ["read:memory"],
    inputSchema: l1SearchInput,
    handler: (args, extra) =>
      handleL1Search(l1SearchInput.parse(args ?? {}), extra) as unknown as Promise<unknown>,
  },
  omniroute_memory_l2_read: {
    name: "omniroute_memory_l2_read",
    description:
      "Layer-2 (scene/pod) memory read by id. Owner-scoped to the calling API key; cross-tenant owner ids in args are rejected.",
    scopes: ["read:memory"],
    inputSchema: l2ReadInput,
    handler: (args, extra) =>
      handleL2Read(l2ReadInput.parse(args ?? {}), extra) as unknown as Promise<unknown>,
  },
  omniroute_memory_l3_read: {
    name: "omniroute_memory_l3_read",
    description:
      "Layer-3 (current persona) memory read. Owner-scoped to the calling API key; cross-tenant owner ids in args are rejected.",
    scopes: ["read:memory"],
    inputSchema: l3ReadInput,
    handler: (args, extra) =>
      handleL3Read(l3ReadInput.parse(args ?? {}), extra) as unknown as Promise<unknown>,
  },
  omniroute_memory_list: {
    name: "omniroute_memory_list",
    description:
      "Cross-layer memory listing (L0+L1+L2+L3) for the calling API key. Owner-scoped; cross-tenant owner ids in args are rejected.",
    scopes: ["read:memory"],
    inputSchema: listInput,
    handler: (args, extra) =>
      handleList(listInput.parse(args ?? {}), extra) as unknown as Promise<unknown>,
  },
};

export { resolveCallerOwner, assertCallerOwner, memoryFetch };
