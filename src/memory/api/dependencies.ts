/**
 * Memory API — dependency-injection registry.
 *
 * The route handlers are deliberately storage-agnostic. They call a
 * strongly-typed service interface (`MemoryFourLayerService`) and the
 * validation / task / audit helpers through this module. Tests can
 * `setFourLayerServiceForTesting(...)` and `setProviderModelValidator(...)`
 * to swap real storage for a stub without touching the route code.
 *
 * **Hard rules enforced here:**
 *  - Routes never import from `src/memory/db/*` (DB schema is owned by the
 *    TencentDB integration branch). The service contract is the boundary.
 *  - No raw SQL in route handlers.
 *  - Audit / task enqueue / provider-model validation are all DI'd so the
 *    unit tests can replace them with fakes.
 */
import { createRequire } from "node:module";

import type { z } from "zod";

import type {
  L0Import,
  L0DeleteBody,
  L0DeleteAll,
  L1Create,
  L1Update,
  L1DeleteBody,
  L2Create,
  L2Update,
  L2DeleteBody,
  L2Regenerate,
  L3Upsert,
  L3DeleteBody,
  L3Regenerate,
  DistillationPut,
  DistillationDlqRetry,
} from "@/shared/schemas/memoryFourLayer";

/**
 * Lightweight `require` for runtime ESM — used to *optionally* resolve
 * `src/memory/db/service.ts` at runtime. If the file is absent (which it is
 * at the time of writing — the storage repo lives in a separate branch),
 * the default no-op service is used so the API surface still exists.
 */
type NodeRequire = ReturnType<typeof createRequire>;

let _require: NodeRequire | null = null;
function safeRequire(): NodeRequire | null {
  if (_require) return _require;
  try {
    _require = createRequire(`${process.cwd()}/package.json`);
  } catch {
    return null;
  }
  return _require;
}

// ────────────────────────────── Domain entities ──────────────────────────────

export interface MemoryL0 {
  id: string;
  ownerApiKeyId: string;
  sessionId: string;
  sourceId: string | null;
  sceneName: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface MemoryL1 {
  id: string;
  ownerApiKeyId: string;
  type: string;
  priority: number;
  content: string;
  sceneName: string;
  metadata: Record<string, unknown>;
  sourceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MemoryL2 {
  id: string;
  ownerApiKeyId: string;
  sessionId: string | null;
  sourceId: string | null;
  sceneName: string | null;
  content: string;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  errorCount: number;
}

export interface MemoryL3 {
  id: string;
  ownerApiKeyId: string;
  sourceLayer: "l0" | "l1" | "l2";
  sourceId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DistillationSelector {
  provider: string;
  modelId: string;
  sourceLayer: "per-key" | "global" | "env" | "auto";
  apiKeyId: string | null;
  scope: "self" | "global" | null;
}

export interface DistillationDlqEntry {
  id: string;
  ownerApiKeyId: string;
  sourceLayer: "l0" | "l1" | "l2";
  sourceId: string | null;
  errorMessage: string;
  errorAt: string;
  retryCount: number;
  status: "pending" | "running" | "failed" | "succeeded";
  lastErrorCode: string | null;
}

export interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface L1ListingQuery {
  page?: number;
  limit?: number;
  offset?: number;
  apiKeyId?: string;
  sessionId?: string;
  sceneName?: string;
  sourceId?: string;
  type?: string;
  q?: string;
  includeDeleted?: "active" | "deleted" | "any";
}

export interface RegenerateEnqueueResult {
  enqueued: number;
  /** When the call was rejected because the rolling error count exceeded the cap. */
  rejected?: { reason: string; waitingWindowSec: number };
}

// ────────────────────────────── Service interface ──────────────────────────────

/**
 * The strongly-typed storage contract. Every route handler depends on this
 * interface only — never on `@/lib/db/*` or `@/lib/memory/db/*`. Adapters
 * for the real storage live under `src/memory/db/` (TencentDB integration
 * branch); when that module is absent the default no-op adapter is used.
 */
export interface MemoryFourLayerService {
  // L0
  importL0(input: { actor: AuthSubject; data: L0Import }): Promise<{ importedIds: string[] }>;
  listL0(actor: AuthSubject, query: L1ListingQuery): Promise<ListResult<MemoryL0>>;
  getL0(actor: AuthSubject, id: string): Promise<MemoryL0 | null>;
  deleteL0(actor: AuthSubject, id: string, mode: L0DeleteBody["mode"]): Promise<boolean>;
  deleteL0Session(
    actor: AuthSubject,
    sessionId: string,
    mode: L0DeleteAll["mode"]
  ): Promise<{ deleted: number }>;
  restoreL0(actor: AuthSubject, id: string): Promise<MemoryL0 | null>;

  // L1
  createL1(actor: AuthSubject, data: L1Create): Promise<MemoryL1>;
  listL1(actor: AuthSubject, query: L1ListingQuery): Promise<ListResult<MemoryL1>>;
  searchL1(actor: AuthSubject, query: L1ListingQuery): Promise<ListResult<MemoryL1>>;
  getL1(actor: AuthSubject, id: string): Promise<MemoryL1 | null>;
  updateL1(
    actor: AuthSubject,
    id: string,
    data: L1Update
  ): Promise<{ entry: MemoryL1; conflict: boolean }>;
  deleteL1(actor: AuthSubject, id: string, mode: L1DeleteBody["mode"]): Promise<boolean>;
  restoreL1(actor: AuthSubject, id: string): Promise<MemoryL1 | null>;

  // L2
  createL2(actor: AuthSubject, data: L2Create): Promise<MemoryL2>;
  listL2(actor: AuthSubject, query: L1ListingQuery): Promise<ListResult<MemoryL2>>;
  getL2(actor: AuthSubject, id: string): Promise<MemoryL2 | null>;
  updateL2(actor: AuthSubject, id: string, data: L2Update): Promise<MemoryL2>;
  deleteL2(actor: AuthSubject, id: string, mode: L2DeleteBody["mode"]): Promise<boolean>;
  restoreL2(actor: AuthSubject, id: string): Promise<MemoryL2 | null>;
  regenerateL2(
    actor: AuthSubject,
    id: string,
    data: L2Regenerate
  ): Promise<RegenerateEnqueueResult>;

  // L3
  listL3(actor: AuthSubject, query: L1ListingQuery): Promise<ListResult<MemoryL3>>;
  getL3(actor: AuthSubject, id: string): Promise<MemoryL3 | null>;
  upsertL3(actor: AuthSubject, data: L3Upsert): Promise<MemoryL3>;
  deleteL3(actor: AuthSubject, id: string, mode: L3DeleteBody["mode"]): Promise<boolean>;
  restoreL3(actor: AuthSubject, id: string): Promise<MemoryL3 | null>;
  regenerateL3(actor: AuthSubject, data: L3Regenerate): Promise<RegenerateEnqueueResult>;

  // Distillation-model
  getDistillationSelector(
    actor: AuthSubject,
    apiKeyId: string | null
  ): Promise<DistillationSelector>;
  setDistillationSelector(actor: AuthSubject, data: DistillationPut): Promise<DistillationSelector>;
  deleteDistillationSelector(
    actor: AuthSubject,
    scope: DistillationPut["scope"],
    apiKeyId: string | null
  ): Promise<boolean>;

  // Distillation DLQ
  listDistillationDlq(
    actor: AuthSubject,
    options: { limit: number; statuses: DistillationDlqEntry["status"][] }
  ): Promise<{ entries: DistillationDlqEntry[]; statusCounts: Record<string, number> }>;
  retryDistillationDlq(
    actor: AuthSubject,
    data: DistillationDlqRetry
  ): Promise<{ retried: number; skipped: number }>;
}

// ────────────────────────────── Auth subject ──────────────────────────────

export interface AuthSubject {
  /** The API key ID the request authenticated as (always set for self scopes). */
  apiKeyId: string | null;
  /** Identity for the management dashboard session; absent for API-key callers. */
  userId: string | null;
  /** Source label — `apiKey`, `dashboard`, `cliToken`. */
  actor: "apiKey" | "dashboard" | "cliToken";
  /** True when the caller carries the `manage` scope. */
  isManagement: boolean;
  /** Bearer token (empty when caller is dashboard session). */
  apiKey: string;
}

// ────────────────────────────── Other dependencies ──────────────────────────────

export interface ProviderModelValidator {
  (input: {
    provider: string;
    modelId: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface AuditWriter {
  (input: {
    action: string;
    actor: AuthSubject;
    target: string;
    resourceType: string;
    details?: unknown;
    request?: Request;
  }): Promise<void>;
}

export interface TaskEnqueuer {
  /** Enqueue a regeneration task. Returns the task id. */
  (input: {
    layer: "l2" | "l3";
    entryId: string;
    ownerApiKeyId: string;
    reason?: string;
  }): Promise<{ taskId: string }>;
}

// ────────────────────────────── Default no-op service ──────────────────────────────

class NotImplementedService implements MemoryFourLayerService {
  private fail(): never {
    throw new Error("memory four-layer storage not wired");
  }
  importL0(): Promise<{ importedIds: string[] }> {
    return this.fail();
  }
  listL0(): Promise<ListResult<MemoryL0>> {
    return this.fail();
  }
  getL0(): Promise<MemoryL0 | null> {
    return this.fail();
  }
  deleteL0(): Promise<boolean> {
    return this.fail();
  }
  deleteL0Session(): Promise<{ deleted: number }> {
    return this.fail();
  }
  restoreL0(): Promise<MemoryL0 | null> {
    return this.fail();
  }
  createL1(): Promise<MemoryL1> {
    return this.fail();
  }
  listL1(): Promise<ListResult<MemoryL1>> {
    return this.fail();
  }
  searchL1(): Promise<ListResult<MemoryL1>> {
    return this.fail();
  }
  getL1(): Promise<MemoryL1 | null> {
    return this.fail();
  }
  updateL1(): Promise<{ entry: MemoryL1; conflict: boolean }> {
    return this.fail();
  }
  deleteL1(): Promise<boolean> {
    return this.fail();
  }
  restoreL1(): Promise<MemoryL1 | null> {
    return this.fail();
  }
  createL2(): Promise<MemoryL2> {
    return this.fail();
  }
  listL2(): Promise<ListResult<MemoryL2>> {
    return this.fail();
  }
  getL2(): Promise<MemoryL2 | null> {
    return this.fail();
  }
  updateL2(): Promise<MemoryL2> {
    return this.fail();
  }
  deleteL2(): Promise<boolean> {
    return this.fail();
  }
  restoreL2(): Promise<MemoryL2 | null> {
    return this.fail();
  }
  regenerateL2(): Promise<RegenerateEnqueueResult> {
    return this.fail();
  }
  listL3(): Promise<ListResult<MemoryL3>> {
    return this.fail();
  }
  getL3(): Promise<MemoryL3 | null> {
    return this.fail();
  }
  upsertL3(): Promise<MemoryL3> {
    return this.fail();
  }
  deleteL3(): Promise<boolean> {
    return this.fail();
  }
  restoreL3(): Promise<MemoryL3 | null> {
    return this.fail();
  }
  regenerateL3(): Promise<RegenerateEnqueueResult> {
    return this.fail();
  }
  getDistillationSelector(): Promise<DistillationSelector> {
    return this.fail();
  }
  setDistillationSelector(): Promise<DistillationSelector> {
    return this.fail();
  }
  deleteDistillationSelector(): Promise<boolean> {
    return this.fail();
  }
  listDistillationDlq(): Promise<{
    entries: DistillationDlqEntry[];
    statusCounts: Record<string, number>;
  }> {
    return this.fail();
  }
  retryDistillationDlq(): Promise<{ retried: number; skipped: number }> {
    return this.fail();
  }
}

// ────────────────────────────── Registry & defaults ──────────────────────────────

const _noImpl = new NotImplementedService();
let _service: MemoryFourLayerService = _noImpl;
let _validator: ProviderModelValidator = defaultValidator;
let _audit: AuditWriter = defaultAuditWriter;
let _enqueuer: TaskEnqueuer = defaultTaskEnqueuer;

export function getFourLayerService(): MemoryFourLayerService {
  return _service;
}

export function setFourLayerServiceForTesting(svc: MemoryFourLayerService): void {
  _service = svc;
}

export function resetFourLayerServiceForTesting(): void {
  _service = _noImpl;
}

export function getProviderModelValidator(): ProviderModelValidator {
  return _validator;
}

export function setProviderModelValidatorForTesting(v: ProviderModelValidator): void {
  _validator = v;
}

export function resetProviderModelValidatorForTesting(): void {
  _validator = defaultValidator;
}

export function getAuditWriter(): AuditWriter {
  return _audit;
}

export function setAuditWriterForTesting(w: AuditWriter): void {
  _audit = w;
}

export function resetAuditWriterForTesting(): void {
  _audit = defaultAuditWriter;
}

export function getTaskEnqueuer(): TaskEnqueuer {
  return _enqueuer;
}

export function setTaskEnqueuerForTesting(t: TaskEnqueuer): void {
  _enqueuer = t;
}

export function resetTaskEnqueuerForTesting(): void {
  _enqueuer = defaultTaskEnqueuer;
}

// ────────────────────────────── Default impls (best-effort) ──────────────────────────────

/**
 * Default validator — uses the synced-available-model table to verify that
 * the requested provider+model is actually configured AND has been synced.
 * If the DB helpers are unavailable (storage repo not yet wired), falls back
 * to a permissive `ok: true` so the API surface still works.
 */
async function defaultValidator(input: {
  provider: string;
  modelId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const { getSyncedAvailableModelsByConnection } = await import(
      /* @vite-ignore */ "@/lib/db/models"
    );
    const rows = await getSyncedAvailableModelsByConnection(input.provider, { limit: 1000 });
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.model) ids.add(r.model);
    }
    if (!ids.has(input.modelId)) {
      return { ok: false, reason: "model not in synced available catalog" };
    }
    return { ok: true };
  } catch {
    // Storage repo absent — accept the input during bootstrap.
    return { ok: true };
  }
}

async function defaultAuditWriter(input: {
  action: string;
  actor: AuthSubject;
  target: string;
  resourceType: string;
  details?: unknown;
  request?: Request;
}): Promise<void> {
  try {
    const { logAuditEvent } = await import(/* @vite-ignore */ "@/lib/compliance/index");
    logAuditEvent({
      action: input.action,
      actor: input.actor.userId || input.actor.apiKeyId || "anon",
      target: input.target,
      resourceType: input.resourceType,
      details: input.details,
      status: "success",
    });
  } catch {
    // Audit must never break the request.
  }
}

async function defaultTaskEnqueuer(): Promise<{ taskId: string }> {
  // The worker module lives on the storage branch. When absent, return a
  // synthetic id so the API surface still works.
  return { taskId: `pending-${Date.now()}` };
}

// ────────────────────────────── Helpers ──────────────────────────────

export function isNoOpService(): boolean {
  return _service === _noImpl;
}
