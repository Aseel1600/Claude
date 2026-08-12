/**
 * Unit tests for the memory four-layer dependency-injection registry.
 *
 *  - default service is the no-op service and throws `not wired`
 *  - tests can swap the service via setFourLayerServiceForTesting
 *  - tests can swap the validator / audit writer / task enqueuer
 *  - the default validator is permissive when the storage repo is absent
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  getFourLayerService,
  isNoOpService,
  resetFourLayerServiceForTesting,
  setFourLayerServiceForTesting,
  getProviderModelValidator,
  setProviderModelValidatorForTesting,
  resetProviderModelValidatorForTesting,
  getAuditWriter,
  setAuditWriterForTesting,
  resetAuditWriterForTesting,
  getTaskEnqueuer,
  setTaskEnqueuerForTesting,
  resetTaskEnqueuerForTesting,
  type MemoryFourLayerService,
  type ProviderModelValidator,
  type AuditWriter,
  type TaskEnqueuer,
} from "../../src/memory/api/dependencies.ts";

test.afterEach(() => {
  resetFourLayerServiceForTesting();
  resetProviderModelValidatorForTesting();
  resetAuditWriterForTesting();
  resetTaskEnqueuerForTesting();
});

test("default service is the no-op adapter", () => {
  assert.ok(isNoOpService());
  const svc = getFourLayerService();
  assert.rejects(() => svc.listL1({} as never, {}), /memory four-layer storage not wired/);
});

test("setFourLayerServiceForTesting replaces the service", async () => {
  const fakeService: MemoryFourLayerService = {
    importL0: async () => ({ importedIds: ["1"] }),
    listL0: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    getL0: async () => null,
    deleteL0: async () => true,
    deleteL0Session: async () => ({ deleted: 0 }),
    restoreL0: async () => null,
    createL1: async () => ({
      id: "x",
      ownerApiKeyId: "k",
      type: "factual",
      priority: 50,
      content: "c",
      sceneName: "s",
      metadata: {},
      sourceId: null,
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    }),
    listL1: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    searchL1: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    getL1: async () => null,
    updateL1: async () => ({
      entry: {
        id: "x",
        ownerApiKeyId: "k",
        type: "factual",
        priority: 50,
        content: "c",
        sceneName: "s",
        metadata: {},
        sourceId: null,
        version: 2,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      },
      conflict: false,
    }),
    deleteL1: async () => true,
    restoreL1: async () => null,
    createL2: async () => ({
      id: "x",
      ownerApiKeyId: "k",
      sessionId: null,
      sourceId: null,
      sceneName: null,
      content: "c",
      metadata: {},
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      errorCount: 0,
    }),
    listL2: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    getL2: async () => null,
    updateL2: async () => ({
      id: "x",
      ownerApiKeyId: "k",
      sessionId: null,
      sourceId: null,
      sceneName: null,
      content: "c",
      metadata: {},
      version: 2,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      errorCount: 0,
    }),
    deleteL2: async () => true,
    restoreL2: async () => null,
    regenerateL2: async () => ({ enqueued: 1 }),
    listL3: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    getL3: async () => null,
    upsertL3: async () => ({
      id: "x",
      ownerApiKeyId: "k",
      sourceLayer: "l2",
      sourceId: null,
      content: "c",
      metadata: {},
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    }),
    deleteL3: async () => true,
    restoreL3: async () => null,
    regenerateL3: async () => ({ enqueued: 1 }),
    getDistillationSelector: async () => ({
      provider: "openai",
      modelId: "gpt-4o-mini",
      sourceLayer: "auto",
      apiKeyId: null,
      scope: null,
    }),
    setDistillationSelector: async () => ({
      provider: "openai",
      modelId: "gpt-4o-mini",
      sourceLayer: "global",
      apiKeyId: null,
      scope: "global",
    }),
    deleteDistillationSelector: async () => true,
    listDistillationDlq: async () => ({ entries: [], statusCounts: { pending: 0, failed: 0 } }),
    retryDistillationDlq: async () => ({ retried: 0, skipped: 0 }),
  };

  setFourLayerServiceForTesting(fakeService);
  assert.equal(isNoOpService(), false);

  const result = await getFourLayerService().listL1({} as never, {});
  assert.deepEqual(result, { data: [], total: 0, page: 1, limit: 20 });
});

test("setProviderModelValidatorForTesting replaces the validator", async () => {
  let received: { provider: string; modelId: string } | null = null;
  const fake: ProviderModelValidator = async (input) => {
    received = input;
    return { ok: false, reason: "fake-reject" };
  };
  setProviderModelValidatorForTesting(fake);
  const out = await getProviderModelValidator()({ provider: "openai", modelId: "x" });
  assert.deepEqual(received, { provider: "openai", modelId: "x" });
  assert.deepEqual(out, { ok: false, reason: "fake-reject" });
});

test("setAuditWriterForTesting replaces the audit writer", async () => {
  let called = 0;
  const fake: AuditWriter = async () => {
    called++;
  };
  setAuditWriterForTesting(fake);
  await getAuditWriter()({
    action: "memory.l1.create",
    actor: { apiKeyId: "k", userId: null, actor: "apiKey", isManagement: false, apiKey: "" },
    target: "x",
    resourceType: "memory_l1",
  });
  assert.strictEqual(called, 1);
});

test("setTaskEnqueuerForTesting replaces the task enqueuer", async () => {
  const fake: TaskEnqueuer = async () => ({ taskId: "fake-task-id" });
  setTaskEnqueuerForTesting(fake);
  const out = await getTaskEnqueuer()({
    layer: "l2",
    entryId: "abc",
    ownerApiKeyId: "k",
  });
  assert.deepEqual(out, { taskId: "fake-task-id" });
});
