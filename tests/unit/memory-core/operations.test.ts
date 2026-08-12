/**
 * tests/unit/memory-core/operations.test.ts
 *
 * Operations tests: task_queue (enqueue/claim/transition/retry/DLQ/list),
 * task_lock (acquire/renew/release with TTL), memory_settings (get/upsert/soft-delete),
 * embedding metadata.
 *
 * Also exercises the issue #10 intent — model_unset and credentials_invalid are
 * present as DLQ error classes in addition to the other canonical values.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-mem-ops-"));
process.env["DATA_DIR"] = TEST_DATA_DIR;
process.env["DISABLE_SQLITE_AUTO_BACKUP"] = "true";

const coreDb = await import("../../../src/memory/db/core.ts");
const { resetMemoryDbInstance, getMemoryDbFilePath } = coreDb;
const ops = await import("../../../src/memory/operations.ts");

test.after(() => {
  try {
    resetMemoryDbInstance();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function wipeDb(): void {
  try {
    resetMemoryDbInstance();
  } catch {
    /* ignore */
  }
  const filePath = getMemoryDbFilePath();
  if (typeof filePath === "string" && filePath !== ":memory:") {
    for (const p of [filePath, `${filePath}-wal`, `${filePath}-shm`, `${filePath}-journal`]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

const OWNER_A = { teamId: "team-1", userId: "user-a", agentId: "agent-a" };

// ──────────────── Task queue ────────────────

test("enqueueTask creates a queued task; status starts as pending", () => {
  wipeDb();
  const t = ops.enqueueTask({
    owner: OWNER_A,
    kind: "extract",
    payload: { foo: "bar" },
  });
  assert.ok(t.taskId);
  assert.equal(t.status, "pending");
  assert.equal(t.kind, "extract");
  assert.equal(t.attempts, 0);
});

test("claimTask transitions pending -> running, returns the claimed task", () => {
  wipeDb();
  const t = ops.enqueueTask({ owner: OWNER_A, kind: "extract", payload: {} });
  const claimed = ops.claimTask(t.taskId, "worker-1");
  assert.ok(claimed);
  assert.equal(claimed!.status, "running");
  assert.equal(claimed!.claimedBy, "worker-1");
});

test("claimTask is exclusive — second claim returns null while first holds it", () => {
  wipeDb();
  const t = ops.enqueueTask({ owner: OWNER_A, kind: "extract", payload: {} });
  const c1 = ops.claimTask(t.taskId, "worker-1");
  assert.ok(c1);
  const c2 = ops.claimTask(t.taskId, "worker-2");
  assert.equal(c2, null, "second claim must fail while first holds the lock");
});

test("transitionTask: running -> done releases the task; running -> failed increments attempts", () => {
  wipeDb();
  const t = ops.enqueueTask({ owner: OWNER_A, kind: "extract", payload: {} });
  ops.claimTask(t.taskId, "worker-1");
  const done = ops.transitionTask(t.taskId, "done");
  assert.equal(done!.status, "done");
  const failed = ops.enqueueTask({ owner: OWNER_A, kind: "summarize", payload: {} });
  ops.claimTask(failed.taskId, "worker-1");
  const res = ops.transitionTask(failed.taskId, "failed", { errorClass: "transient" });
  assert.equal(res!.status, "pending", "failed task should retry and return to pending");
  assert.equal(res!.attempts, 1);
});

test("retryTask moves pending task back to pending with attempts incremented", () => {
  wipeDb();
  const t = ops.enqueueTask({ owner: OWNER_A, kind: "extract", payload: {} });
  ops.claimTask(t.taskId, "worker-1");
  ops.transitionTask(t.taskId, "failed", { errorClass: "transient" });
  const retried = ops.getTask(t.taskId);
  assert.equal(retried!.attempts, 1);
  assert.equal(retried!.status, "pending");
});

test("retryTask beyond max attempts -> DLQ", () => {
  wipeDb();
  const t = ops.enqueueTask({ owner: OWNER_A, kind: "extract", payload: {}, maxAttempts: 2 });
  for (let i = 0; i < 3; i++) {
    ops.claimTask(t.taskId, "w");
    ops.transitionTask(t.taskId, "failed", { errorClass: "transient" });
  }
  const final = ops.getTask(t.taskId);
  assert.equal(final!.status, "dlq");
  assert.ok(final!.lastErrorClass === "transient");
});

test("DLQ records last_error_class including model_unset and credentials_invalid", () => {
  wipeDb();
  const t1 = ops.enqueueTask({ owner: OWNER_A, kind: "custom", payload: {}, maxAttempts: 1 });
  ops.claimTask(t1.taskId, "w");
  ops.transitionTask(t1.taskId, "failed", { errorClass: "model_unset" });
  const r1 = ops.getTask(t1.taskId);
  assert.equal(r1!.status, "dlq");
  assert.equal(r1!.lastErrorClass, "model_unset");

  const t2 = ops.enqueueTask({ owner: OWNER_A, kind: "custom", payload: {}, maxAttempts: 1 });
  ops.claimTask(t2.taskId, "w");
  ops.transitionTask(t2.taskId, "failed", { errorClass: "credentials_invalid" });
  const r2 = ops.getTask(t2.taskId);
  assert.equal(r2!.status, "dlq");
  assert.equal(r2!.lastErrorClass, "credentials_invalid");
});

test("listTasksByStatus filters by status", () => {
  wipeDb();
  ops.enqueueTask({ owner: OWNER_A, kind: "extract", payload: {} });
  const t2 = ops.enqueueTask({ owner: OWNER_A, kind: "summarize", payload: {} });
  ops.claimTask(t2.taskId, "w");
  ops.transitionTask(t2.taskId, "done");
  const dlq = ops.listTasksByStatus(OWNER_A, "done");
  assert.equal(dlq.length, 1);
  assert.equal(dlq[0]!.taskId, t2.taskId);
});

// ──────────────── Locks ────────────────

test("acquireLock — owner is unique; renew resets expiration; release frees", () => {
  wipeDb();
  const a = ops.acquireLock({ owner: OWNER_A, key: "extract", ttlMs: 1000 });
  assert.equal(a.acquired, true);
  const b = ops.acquireLock({ owner: OWNER_A, key: "extract", ttlMs: 1000 });
  assert.equal(b.acquired, false, "owner-held lock cannot be re-acquired");
  // Renew succeeds
  const r = ops.renewLock({ owner: OWNER_A, key: "extract", ttlMs: 5000 });
  assert.equal(r.renewed, true);
  // Release
  const rel = ops.releaseLock({ owner: OWNER_A, key: "extract" });
  assert.equal(rel.released, true);
  const c = ops.acquireLock({ owner: OWNER_A, key: "extract", ttlMs: 1000 });
  assert.equal(c.acquired, true);
});

test("lock with expired TTL is reclaimable", async () => {
  wipeDb();
  const a = ops.acquireLock({ owner: OWNER_A, key: "k", ttlMs: 1 });
  assert.equal(a.acquired, true);
  await new Promise((r) => setTimeout(r, 10));
  const b = ops.acquireLock({ owner: OWNER_A, key: "k", ttlMs: 1000 });
  assert.equal(b.acquired, true, "lock should be reclaimable after expiration");
});

// ──────────────── Settings ────────────────

test("getSetting returns null for unset key", () => {
  wipeDb();
  const v = ops.getSetting("missing-key");
  assert.equal(v, null);
});

test("upsertSetting stores value; second call updates in place; version increments", () => {
  wipeDb();
  const v1 = ops.upsertSetting("foo", "v1");
  assert.equal(v1.key, "foo");
  assert.equal(v1.value, "v1");
  assert.equal(v1.version, 1);
  const v2 = ops.upsertSetting("foo", "v2");
  assert.equal(v2.version, 2);
  assert.equal(v2.value, "v2");
});

test("softDeleteSetting sets deleted_at; getSetting returns null; setting key includes deleted surface", () => {
  wipeDb();
  ops.upsertSetting("foo", "bar");
  ops.softDeleteSetting("foo");
  const v = ops.getSetting("foo");
  assert.equal(v, null);
  const incl = ops.getSetting("foo", { includeDeleted: true });
  assert.ok(incl);
  assert.ok(incl!.deletedAt !== null);
});

// ──────────────── Embedding metadata ────────────────

test("upsertEmbeddingMeta stores signature/dim/source; getEmbeddingMeta returns it", () => {
  wipeDb();
  ops.upsertEmbeddingMeta({
    signature: "openai:text-embedding-3-small:1536",
    activeDim: 1536,
    source: "remote",
  });
  const m = ops.getEmbeddingMeta();
  assert.ok(m);
  assert.equal(m!.signature, "openai:text-embedding-3-small:1536");
  assert.equal(m!.activeDim, 1536);
  assert.equal(m!.source, "remote");
  assert.ok(m!.updatedAt && m!.updatedAt.length > 0);
});

test("upsertEmbeddingMeta second call updates; signature mismatch resets", () => {
  wipeDb();
  ops.upsertEmbeddingMeta({ signature: "s1", activeDim: 4, source: "remote" });
  ops.upsertEmbeddingMeta({ signature: "s2", activeDim: 8, source: "remote" });
  const m = ops.getEmbeddingMeta();
  assert.equal(m!.signature, "s2");
  assert.equal(m!.activeDim, 8);
});
