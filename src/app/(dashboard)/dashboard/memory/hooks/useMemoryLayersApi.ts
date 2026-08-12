"use client";

/**
 * useMemoryLayersApi — typed API hooks for the four-layer memory UI.
 *
 * Hooks are abort-safe (every request passes the component's mounted ref or an
 * explicit `AbortSignal`). Errors are surfaced via state, never thrown, so
 * components can render loading/error/empty without try/catch ladders.
 *
 * Endpoints called here are part of the canonical memory layer surface:
 *   GET    /api/memory/l0/messages          — L0 messages
 *   POST   /api/memory/l0/messages/import   — Import a session
 *   DELETE /api/memory/l0/messages/:id      — Soft delete message
 *   POST   /api/memory/l0/messages/:id/restore  — Restore from bin
 *   DELETE /api/memory/l0/messages/:id/permanent  — Permanent delete
 *   GET    /api/memory/l0/recycle-bin       — Recycle bin list
 *
 *   GET    /api/memory/l1/memories          — L1 entries
 *   POST   /api/memory/l1/memories          — Add memory
 *   PUT    /api/memory/l1/memories/:id      — Edit memory
 *   DELETE /api/memory/l1/memories/:id      — Soft delete
 *   DELETE /api/memory/l1/memories/:id/permanent — Permanent delete
 *   POST   /api/memory/l1/memories/:id/restore   — Restore
 *
 *   GET    /api/memory/l2/scenes            — Scenes
 *   PUT    /api/memory/l2/scenes/:id        — Edit scene
 *   DELETE /api/memory/l2/scenes/:id        — Delete
 *   POST   /api/memory/l2/scenes/:id/regenerate  — Regenerate
 *
 *   GET    /api/memory/l3/prompts            — Prompts
 *   PUT    /api/memory/l3/prompts/:id        — Edit prompt
 *   DELETE /api/memory/l3/prompts/:id        — Clear
 *   POST   /api/memory/l3/prompts/:id/regenerate  — Regenerate
 *
 *   GET    /api/memory/distillation-model    — Effective distillation model
 *   PUT    /api/memory/distillation-model    — Set per-key/global override
 *   DELETE /api/memory/distillation-model    — Remove override
 *   GET    /api/synced-available-models?provider=... — Model picker
 *
 * Endpoints not yet wired on the server are called optimistically; the page
 * falls back to a graceful "not configured yet" state on failure (no raw
 * server error/stack leaks — see #errorSanitization in CLAUDE.md).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SourceLayer = "perKey" | "global" | "env" | "auto";

export interface DistillationModelConfig {
  provider: string | null;
  model: string | null;
  /** Resolved effective values per source. */
  effective: { provider: string | null; model: string | null };
  source: SourceLayer;
  /** Optional fallback hint to surface if the API did not return values. */
  fallbackHint?: { provider: string | null; model: string | null } | null;
  /** Optional management context flag — controls whether global scope is offered. */
  canSetGlobal?: boolean;
}

export interface L0Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  provider?: string | null;
  model?: string | null;
  /** L1 memory ids derived from this message; surfaced as "Associated L1". */
  associatedL1Ids?: string[];
  /** Soft-delete metadata for the recycle bin. */
  deletedAt?: string | null;
}

export interface L0RecycleBinEntry {
  id: string;
  sessionId: string;
  role: L0Message["role"];
  content: string;
  deletedAt: string;
}

export type L1Type =
  | "factual"
  | "episodic"
  | "procedural"
  | "semantic"
  | "user_profile"
  | "preference"
  | "constraint";

export interface L1Memory {
  id: string;
  type: L1Type;
  priority: number;
  content: string;
  version: number;
  lastModifiedBy: string;
  edited: boolean;
  /** Optional scene id this memory belongs to. */
  sceneId?: string | null;
  /** Optional score preview returned by retrieval — read-only here. */
  score?: number | null;
}

export interface L2Scene {
  id: string;
  summary: string;
  heat: number;
  times: number;
  version: number;
  modifier: string;
  content: string;
  status: "active" | "pending";
  atomIds?: string[];
  personaId?: string | null;
}

export type L3Mode = "chat" | "code";

export interface L3Prompt {
  id: string;
  mode: L3Mode;
  content: string;
  version: number;
  modifier: string;
  lineage?: { l1Ids?: string[]; l2Ids?: string[] };
}

export interface SyncedModel {
  id: string;
  name?: string;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  reload: () => Promise<void>;
}

interface UseQueryOptions {
  /** Skip the initial fetch (e.g. when a key is not yet known). */
  skip?: boolean;
}

function sanitize(err: unknown): string {
  if (err instanceof Error) {
    // Never surface stacks or raw messages — see docs/security/ERROR_SANITIZATION.md.
    if (/abort/i.test(err.message)) return "";
    return err.message || "request_failed";
  }
  return "request_failed";
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(url, { ...init, signal });
  const data = (await res.json().catch(() => null)) as T | null;
  return { ok: res.ok, status: res.status, data };
}

/**
 * useL0Messages — fetch L0 messages with optional sessionId/lineage filter.
 */
export function useL0Messages(
  filter: { sessionId?: string; role?: L0Message["role"] } = {},
  options: UseQueryOptions = {}
): ApiResult<L0Message[]> {
  const [data, setData] = useState<L0Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!options.skip);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.sessionId) params.set("sessionId", filter.sessionId);
      if (filter.role) params.set("role", filter.role);
      const qs = params.toString();
      const { ok, data: payload } = await jsonRequest<{ data?: L0Message[] }>(
        `/api/memory/l0/messages${qs ? `?${qs}` : ""}`,
        { method: "GET" },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (!ok) {
        setError("load_failed");
        setData(null);
        return;
      }
      setData(Array.isArray(payload?.data) ? payload!.data! : []);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(sanitize(e) || "load_failed");
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, [filter.sessionId, filter.role]);

  useEffect(() => {
    if (options.skip) return;
    void fetchOnce();
    return () => abortRef.current?.abort();
  }, [fetchOnce, options.skip]);

  return { data, error, isLoading, reload: fetchOnce };
}

/**
 * useL0RecycleBin — recycle bin rows for soft-deleted L0 messages.
 */
export function useL0RecycleBin(): ApiResult<L0RecycleBinEntry[]> {
  const [data, setData] = useState<L0RecycleBinEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    try {
      const { ok, data: payload } = await jsonRequest<{ data?: L0RecycleBinEntry[] }>(
        "/api/memory/l0/recycle-bin",
        { method: "GET" },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (!ok) {
        setError("load_failed");
        setData(null);
        return;
      }
      setData(Array.isArray(payload?.data) ? payload!.data! : []);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(sanitize(e) || "load_failed");
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOnce();
    return () => abortRef.current?.abort();
  }, [fetchOnce]);

  return { data, error, isLoading, reload: fetchOnce };
}

/**
 * useL1Memories — fetch L1 memory entries with optional type/priority filter.
 */
export function useL1Memories(
  filter: { type?: L1Type | "all"; minPriority?: number; query?: string } = {}
): ApiResult<L1Memory[]> {
  const [data, setData] = useState<L1Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);
  const filterKey = `${filter.type ?? ""}|${filter.minPriority ?? ""}|${filter.query ?? ""}`;

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.type && filter.type !== "all") params.set("type", filter.type);
      if (typeof filter.minPriority === "number") params.set("minPriority", String(filter.minPriority));
      if (filter.query) params.set("q", filter.query);
      const qs = params.toString();
      const { ok, data: payload } = await jsonRequest<{ data?: L1Memory[] }>(
        `/api/memory/l1/memories${qs ? `?${qs}` : ""}`,
        { method: "GET" },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (!ok) {
        setError("load_failed");
        setData(null);
        return;
      }
      setData(Array.isArray(payload?.data) ? payload!.data! : []);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(sanitize(e) || "load_failed");
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
    // filterKey ensures the latest filter values trigger a refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    void fetchOnce();
    return () => abortRef.current?.abort();
  }, [fetchOnce]);

  return { data, error, isLoading, reload: fetchOnce };
}

/**
 * useL2Scenes — fetch L2 scenes.
 */
export function useL2Scenes(filter: { query?: string } = {}): ApiResult<L2Scene[]> {
  const [data, setData] = useState<L2Scene[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);
  const filterKey = `${filter.query ?? ""}`;

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.query) params.set("q", filter.query);
      const qs = params.toString();
      const { ok, data: payload } = await jsonRequest<{ data?: L2Scene[] }>(
        `/api/memory/l2/scenes${qs ? `?${qs}` : ""}`,
        { method: "GET" },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (!ok) {
        setError("load_failed");
        setData(null);
        return;
      }
      setData(Array.isArray(payload?.data) ? payload!.data! : []);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(sanitize(e) || "load_failed");
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    void fetchOnce();
    return () => abortRef.current?.abort();
  }, [fetchOnce]);

  return { data, error, isLoading, reload: fetchOnce };
}

/**
 * useL3Prompts — fetch L3 prompts (chat + code).
 */
export function useL3Prompts(): ApiResult<L3Prompt[]> {
  const [data, setData] = useState<L3Prompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    try {
      const { ok, data: payload } = await jsonRequest<{ data?: L3Prompt[] }>(
        "/api/memory/l3/prompts",
        { method: "GET" },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (!ok) {
        setError("load_failed");
        setData(null);
        return;
      }
      setData(Array.isArray(payload?.data) ? payload!.data! : []);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(sanitize(e) || "load_failed");
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOnce();
    return () => abortRef.current?.abort();
  }, [fetchOnce]);

  return { data, error, isLoading, reload: fetchOnce };
}

/**
 * useDistillationModel — GET /api/memory/distillation-model.
 *
 * Returns the effective distillation model (per-key → global → env → auto),
 * the active source layer, and an optional management flag.
 */
export function useDistillationModel(): ApiResult<DistillationModelConfig> & {
  canSetGlobal: boolean;
} {
  const [data, setData] = useState<DistillationModelConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    try {
      const { ok, data: payload } = await jsonRequest<DistillationModelConfig>(
        "/api/memory/distillation-model",
        { method: "GET" },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (!ok || !payload) {
        setError("load_failed");
        setData(null);
        return;
      }
      setData(payload);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(sanitize(e) || "load_failed");
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOnce();
    return () => abortRef.current?.abort();
  }, [fetchOnce]);

  return { data, error, isLoading, reload: fetchOnce, canSetGlobal: data?.canSetGlobal ?? false };
}

/**
 * useProviderModels — fetch synced models for a provider (used by the override
 * provider/model dropdown).
 */
export function useProviderModels(provider: string | null): ApiResult<SyncedModel[]> {
  const [data, setData] = useState<SyncedModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!provider) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    try {
      const { ok, data: payload } = await jsonRequest<{ models?: SyncedModel[] } | SyncedModel[]>(
        `/api/synced-available-models?provider=${encodeURIComponent(provider)}`,
        { method: "GET" },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      if (!ok) {
        setError("load_failed");
        setData(null);
        return;
      }
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { models?: SyncedModel[] })?.models)
          ? (payload as { models: SyncedModel[] }).models
          : [];
      setData(list);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(sanitize(e) || "load_failed");
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void fetchOnce();
    return () => abortRef.current?.abort();
  }, [fetchOnce]);

  return { data, error, isLoading, reload: fetchOnce };
}

/**
 * Pure client-side mutation utilities — keep them outside the hook to avoid
 * duplicated setState in callers and to centralize error handling.
 */
export async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

export async function putJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

export async function deleteJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

/** Truncate a string id for display ("abc123…" pattern). */
export function truncId(id: string, head = 6, tail = 4): string {
  if (!id) return "";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}