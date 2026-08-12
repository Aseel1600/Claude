/**
 * Unit tests for `src/shared/schemas/memoryFourLayer.ts`.
 *
 *  - 7 L1 types
 *  - L0 has NO PUT/edit in the schema (the schema is read/import/delete-only)
 *  - L1 PUT requires `expectedVersion` (optimistic concurrency)
 *  - DistillationPut requires `apiKeyId` when scope='self'
 *  - DistillationDlqRetry requires `ids` or `all`
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  L1_TYPE_VALUES,
  L1CreateSchema,
  L1UpdateSchema,
  L0ImportSchema,
  DistillationPutSchema,
  DistillationDlqRetrySchema,
} from "../../src/shared/schemas/memoryFourLayer.ts";

test("L1_TYPE_VALUES has exactly 7 types", () => {
  assert.strictEqual(L1_TYPE_VALUES.length, 7);
  for (const t of [
    "factual",
    "episodic",
    "procedural",
    "semantic",
    "preference",
    "constraint",
    "glossary",
  ]) {
    assert.ok(L1_TYPE_VALUES.includes(t as (typeof L1_TYPE_VALUES)[number]));
  }
});

test("L1CreateSchema accepts all 7 types", () => {
  for (const type of L1_TYPE_VALUES) {
    const parsed = L1CreateSchema.safeParse({
      type,
      content: "hello",
      sceneName: "general",
    });
    assert.equal(parsed.success, true, `should accept type=${type}`);
  }
});

test("L1CreateSchema rejects unknown L1 type", () => {
  const parsed = L1CreateSchema.safeParse({
    type: "unknown",
    content: "hello",
    sceneName: "general",
  });
  assert.equal(parsed.success, false);
});

test("L1UpdateSchema REQUIRES expectedVersion (optimistic concurrency)", () => {
  const parsed = L1UpdateSchema.safeParse({ content: "new" });
  assert.equal(parsed.success, false, "should reject missing expectedVersion");
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".");
    assert.ok(field && field.includes("expectedVersion"));
  }
});

test("L1UpdateSchema accepts expectedVersion=0", () => {
  const parsed = L1UpdateSchema.safeParse({ expectedVersion: 0, content: "new" });
  assert.equal(parsed.success, true);
});

test("L1UpdateSchema rejects unknown fields (strict)", () => {
  const parsed = L1UpdateSchema.safeParse({
    expectedVersion: 1,
    random: "x",
  });
  assert.equal(parsed.success, false);
});

test("L0ImportSchema accepts up to 500 items and rejects unknown fields", () => {
  const ok = L0ImportSchema.safeParse({
    apiKeyId: "k1",
    sessionId: "s1",
    items: [
      { payload: { a: 1 } },
      { payload: { b: 2 }, sourceId: "src-1", occurredAt: new Date().toISOString() },
    ],
  });
  assert.equal(ok.success, true);

  const bad = L0ImportSchema.safeParse({
    apiKeyId: "k1",
    sessionId: "s1",
    items: [{ payload: { a: 1 }, secretKey: "should-fail" }],
  });
  assert.equal(bad.success, false);
});

test("L0ImportSchema rejects empty items", () => {
  const parsed = L0ImportSchema.safeParse({
    apiKeyId: "k1",
    sessionId: "s1",
    items: [],
  });
  assert.equal(parsed.success, false);
});

test("DistillationPutSchema requires apiKeyId when scope=self", () => {
  const noKey = DistillationPutSchema.safeParse({
    provider: "openai",
    modelId: "gpt-4o-mini",
    scope: "self",
  });
  assert.equal(noKey.success, false);
  if (!noKey.success) {
    const issue = noKey.error.issues.find((i) => i.path.includes("apiKeyId"));
    assert.ok(issue, "should mention apiKeyId field");
  }

  const ok = DistillationPutSchema.safeParse({
    provider: "openai",
    modelId: "gpt-4o-mini",
    scope: "self",
    apiKeyId: "k1",
  });
  assert.equal(ok.success, true);
});

test("DistillationPutSchema permits global scope without apiKeyId", () => {
  const ok = DistillationPutSchema.safeParse({
    provider: "openai",
    modelId: "gpt-4o-mini",
    scope: "global",
  });
  assert.equal(ok.success, true);
});

test("DistillationDlqRetrySchema requires ids or all", () => {
  const empty = DistillationDlqRetrySchema.safeParse({});
  assert.equal(empty.success, false);

  const ids = DistillationDlqRetrySchema.safeParse({ ids: ["1", "2"] });
  assert.equal(ids.success, true);

  const all = DistillationDlqRetrySchema.safeParse({ all: true });
  assert.equal(all.success, true);
});
