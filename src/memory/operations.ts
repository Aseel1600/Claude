/**
 * src/memory/operations.ts
 *
 * Operations module — task_queue, task_lock, memory_settings, embedding_meta.
 *
 * task_queue: enqueue/claim/transition/retry/DLQ; error classes include
 *   model_unset and credentials_invalid (issue #10 intent) in addition to
 *   the standard transient/timeout/rate_limit/upstream_5xx/validation/
 *   permission_denied/unknown values.
 *
 * task_lock: TTL-based; acquire is owner-scoped and idempotent; renew resets
 *   expiration; release frees. Locks whose expires_at is in the past are
 *   reclaimable (lazy expiry — no background timer).
 *
 * memory_settings: keyed; get/upsert/soft-delete; version increments on update.
 *
 * embedding_meta: single-row table; signature/dim/source/vec_loaded tracking.
 */

import { randomUUID } from "node:crypto";
import { getMemoryDbInstance } from "./db/core.ts";
import type {
  AcquireLockInput,
  AcquireLockResult,
  EmbeddingMeta,
  EnqueueTaskInput,
  MemorySetting,
  Owner,
  TaskDlqErrorClass,
  TaskKind,
  TaskQueueRow,
  TaskStatus,
  TransitionInput,
} from "./types.ts";
import { TASK_DLQ_ERROR_CLASSES, ownerKey } from "./types.ts";

const VALID_ERROR_CLASSES: ReadonlySet<TaskDlqErrorClass> = new Set(TASK_DLQ_ERROR_CLASSES);
const VALID_KINDS: ReadonlySet<TaskKind> = new Set([
  "extract",
  "summarize",
  "embed",
  "reindex",
  "custom",
]);

function validateEnqueue(input: EnqueueTaskInput): void {
  if (!input.owner || !input.owner.teamId || !input.owner.userId || !input.owner.agentId) {
    throw new Error("[memory.ops] owner must include teamId, userId, agentId");
  }
  if (!VALID_KINDS.has(input.kind)) {
    throw new Error(`[memory.ops] invalid kind: ${input.kind}`);
  }
  if (
    typeof input.maxAttempts === "number" &&
    (!Number.isFinite(input.maxAttempts) || input.maxAttempts < 1)
  ) {
    throw new Error("[memory.ops] maxAttempts must be >= 1");
  }
}

// ──────────────── Task queue ────────────────

export function enqueueTask(input: EnqueueTaskInput): TaskQueueRow {
  validateEnqueue(input);
  const db = getMemoryDbInstance();
  const key = ownerKey(input.owner);
  const taskId = randomUUID();
  const maxAttempts = input.maxAttempts ?? 3;

  db.prepare(
    `INSERT INTO task_queue (
      task_id, owner_key, team_id, user_id, agent_id,
      kind, payload, status, attempts, max_attempts
    ) VALUES (
      @task_id, @owner_key, @team_id, @user_id, @agent_id,
      @kind, @payload, 'pending', 0, @max_attempts
    )`
  ).run({
    task_id: taskId,
    owner_key: key,
    team_id: input.owner.teamId,
    user_id: input.owner.userId,
    agent_id: input.owner.agentId,
    kind: input.kind,
    payload: JSON.stringify(input.payload ?? {}),
    max_attempts: maxAttempts,
  });

  return getTask(taskId)!;
}

export function getTask(taskId: string): TaskQueueRow | null {
  const db = getMemoryDbInstance();
  const row = db.prepare("SELECT * FROM task_queue WHERE task_id = ?").get(taskId) as
    TaskQueueRowDb | undefined;
  return row ? rowToTask(row) : null;
}

export function claimTask(taskId: string, claimedBy: string): TaskQueueRow | null {
  const db = getMemoryDbInstance();
  let didClaim = false;
  db.transaction(() => {
    const cur = db.prepare("SELECT status FROM task_queue WHERE task_id = ?").get(taskId) as
      { status: TaskStatus } | undefined;
    if (!cur) return;
    if (cur.status !== "pending") return;
    const result = db
      .prepare(
        `UPDATE task_queue
         SET status = 'running', claimed_by = ?, updated_at = datetime('now')
         WHERE task_id = ? AND status = 'pending'`
      )
      .run(claimedBy, taskId);
    didClaim = (result.changes ?? 0) > 0;
  })();
  if (!didClaim) return null;
  return getTask(taskId);
}

export function transitionTask(
  taskId: string,
  target: "done" | "failed",
  input: TransitionInput = {}
): TaskQueueRow | null {
  const db = getMemoryDbInstance();
  db.transaction(() => {
    const cur = db.prepare("SELECT * FROM task_queue WHERE task_id = ?").get(taskId) as
      TaskQueueRowDb | undefined;
    if (!cur) return;
    if (target === "done") {
      db.prepare(
        `UPDATE task_queue
         SET status = 'done', claimed_by = NULL,
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE task_id = ?`
      ).run(taskId);
      return;
    }
    // target === "failed": increment attempts, set last_error_*, return to pending
    // unless we have hit maxAttempts, in which case → dlq.
    const attempts = cur.attempts + 1;
    const errorClass = input.errorClass ?? "unknown";
    if (!VALID_ERROR_CLASSES.has(errorClass)) {
      throw new Error(`[memory.ops] invalid errorClass: ${errorClass}`);
    }
    if (attempts >= cur.max_attempts) {
      db.prepare(
        `UPDATE task_queue
         SET status = 'dlq', attempts = ?, last_error_class = ?, last_error_message = ?,
             claimed_by = NULL, completed_at = datetime('now'), updated_at = datetime('now')
         WHERE task_id = ?`
      ).run(attempts, errorClass, input.errorMessage ?? null, taskId);
      return;
    }
    db.prepare(
      `UPDATE task_queue
       SET status = 'pending', attempts = ?, last_error_class = ?, last_error_message = ?,
           claimed_by = NULL, updated_at = datetime('now')
       WHERE task_id = ?`
    ).run(attempts, errorClass, input.errorMessage ?? null, taskId);
  })();
  return getTask(taskId);
}

export function listTasksByStatus(owner: Owner, status: TaskStatus): TaskQueueRow[] {
  const db = getMemoryDbInstance();
  const key = ownerKey(owner);
  const rows = db
    .prepare("SELECT * FROM task_queue WHERE owner_key = ? AND status = ? ORDER BY updated_at DESC")
    .all(key, status) as TaskQueueRowDb[];
  return rows.map(rowToTask);
}

// ──────────────── Locks ────────────────

export function acquireLock(input: AcquireLockInput): AcquireLockResult {
  if (!input.owner || !input.owner.teamId || !input.owner.userId || !input.owner.agentId) {
    throw new Error("[memory.ops] owner must include teamId, userId, agentId");
  }
  if (!input.key || typeof input.key !== "string") {
    throw new Error("[memory.ops] key is required");
  }
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new Error("[memory.ops] ttlMs must be a positive number");
  }
  const db = getMemoryDbInstance();
  const key = ownerKey(input.owner);
  const acquiredBy = input.acquiredBy ?? "owner";
  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();

  // Did we successfully claim (either fresh insert or lazy-expiry takeover)?
  let didAcquire = false;
  db.transaction(() => {
    const existing = db
      .prepare("SELECT acquired_by, expires_at FROM task_lock WHERE owner_key = ? AND key = ?")
      .get(key, input.key) as { acquired_by: string; expires_at: string } | undefined;

    if (existing) {
      const expired = new Date(existing.expires_at).getTime() <= Date.now();
      if (expired) {
        db.prepare(
          `UPDATE task_lock SET acquired_by = ?, expires_at = ?, acquired_at = datetime('now')
           WHERE owner_key = ? AND key = ?`
        ).run(acquiredBy, expiresAt, key, input.key);
        didAcquire = true;
      }
      // else: active lock — even same acquirer cannot silently re-acquire.
      return;
    }

    db.prepare(
      `INSERT INTO task_lock (owner_key, key, acquired_by, expires_at)
       VALUES (?, ?, ?, ?)`
    ).run(key, input.key, acquiredBy, expiresAt);
    didAcquire = true;
  })();

  if (!didAcquire) {
    return { acquired: false, expiresAt: null };
  }
  const after = db
    .prepare("SELECT expires_at FROM task_lock WHERE owner_key = ? AND key = ?")
    .get(key, input.key) as { expires_at: string } | undefined;
  return { acquired: true, expiresAt: after?.expires_at ?? null };
}

export function renewLock(input: {
  owner: Owner;
  key: string;
  ttlMs: number;
  acquiredBy?: string;
}): { renewed: boolean; expiresAt: string | null } {
  const db = getMemoryDbInstance();
  const key = ownerKey(input.owner);
  const acquiredBy = input.acquiredBy ?? "owner";
  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();

  const existing = db
    .prepare("SELECT acquired_by, expires_at FROM task_lock WHERE owner_key = ? AND key = ?")
    .get(key, input.key) as { acquired_by: string; expires_at: string } | undefined;
  if (!existing) return { renewed: false, expiresAt: null };
  if (existing.acquired_by !== acquiredBy) return { renewed: false, expiresAt: null };
  if (new Date(existing.expires_at).getTime() <= Date.now()) {
    return { renewed: false, expiresAt: null };
  }

  db.prepare("UPDATE task_lock SET expires_at = ? WHERE owner_key = ? AND key = ?").run(
    expiresAt,
    key,
    input.key
  );
  return { renewed: true, expiresAt };
}

export function releaseLock(input: { owner: Owner; key: string; acquiredBy?: string }): {
  released: boolean;
} {
  const db = getMemoryDbInstance();
  const key = ownerKey(input.owner);
  const acquiredBy = input.acquiredBy ?? "owner";
  const existing = db
    .prepare("SELECT acquired_by FROM task_lock WHERE owner_key = ? AND key = ?")
    .get(key, input.key) as { acquired_by: string } | undefined;
  if (!existing) return { released: false };
  if (existing.acquired_by !== acquiredBy) return { released: false };
  db.prepare("DELETE FROM task_lock WHERE owner_key = ? AND key = ?").run(key, input.key);
  return { released: true };
}

// ──────────────── Settings ────────────────

export function getSetting(
  key: string,
  opts: { includeDeleted?: boolean } = {}
): MemorySetting | null {
  const db = getMemoryDbInstance();
  const sql = opts.includeDeleted
    ? "SELECT * FROM memory_settings WHERE key = ?"
    : "SELECT * FROM memory_settings WHERE key = ? AND deleted_at IS NULL";
  const row = db.prepare(sql).get(key) as MemorySettingRow | undefined;
  return row ? rowToSetting(row) : null;
}

export function upsertSetting(key: string, value: string): MemorySetting {
  const db = getMemoryDbInstance();
  db.transaction(() => {
    const existing = db.prepare("SELECT version FROM memory_settings WHERE key = ?").get(key) as
      { version: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE memory_settings
         SET value = ?, version = ?, updated_at = datetime('now'), deleted_at = NULL
         WHERE key = ?`
      ).run(value, existing.version + 1, key);
    } else {
      db.prepare(`INSERT INTO memory_settings (key, value, version) VALUES (?, ?, 1)`).run(
        key,
        value
      );
    }
  })();
  return getSetting(key, { includeDeleted: true })!;
}

export function softDeleteSetting(key: string): void {
  const db = getMemoryDbInstance();
  db.prepare(
    "UPDATE memory_settings SET deleted_at = datetime('now') WHERE key = ? AND deleted_at IS NULL"
  ).run(key);
}

// ──────────────── Embedding meta ────────────────

export function getEmbeddingMeta(): EmbeddingMeta | null {
  const db = getMemoryDbInstance();
  const row = db.prepare("SELECT * FROM embedding_meta WHERE id = 1").get() as
    EmbeddingMetaRow | undefined;
  return row ? rowToEmbeddingMeta(row) : null;
}

export function upsertEmbeddingMeta(input: {
  signature: string;
  activeDim: number | null;
  source: string;
}): EmbeddingMeta {
  const db = getMemoryDbInstance();
  db.prepare(
    `UPDATE embedding_meta
     SET signature = ?, active_dim = ?, source = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(input.signature, input.activeDim, input.source);
  return getEmbeddingMeta()!;
}

// ──────────────── Row mapping ────────────────

interface TaskQueueRowDb {
  task_id: string;
  owner_key: string;
  team_id: string;
  user_id: string;
  agent_id: string;
  kind: TaskKind;
  payload: string;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  claimed_by: string | null;
  last_error_class: TaskDlqErrorClass | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function rowToTask(r: TaskQueueRowDb): TaskQueueRow {
  let payload: Record<string, unknown> = {};
  try {
    const v = JSON.parse(r.payload);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      payload = v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {
    taskId: r.task_id,
    ownerKey: r.owner_key,
    teamId: r.team_id,
    userId: r.user_id,
    agentId: r.agent_id,
    kind: r.kind,
    payload,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    claimedBy: r.claimed_by,
    lastErrorClass: r.last_error_class,
    lastErrorMessage: r.last_error_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

interface MemorySettingRow {
  key: string;
  value: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToSetting(r: MemorySettingRow): MemorySetting {
  return {
    key: r.key,
    value: r.value,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

interface EmbeddingMetaRow {
  id: number;
  signature: string | null;
  active_dim: number | null;
  source: string | null;
  vec_loaded: number;
  updated_at: string;
}

function rowToEmbeddingMeta(r: EmbeddingMetaRow): EmbeddingMeta {
  return {
    signature: r.signature,
    activeDim: r.active_dim,
    source: r.source,
    vecLoaded: r.vec_loaded === 1,
    updatedAt: r.updated_at,
  };
}
