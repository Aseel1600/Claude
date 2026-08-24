/**
 * GHSA-jcm5-6wpp-wjj8 — A2A task IDOR + unauthenticated REST task routes.
 *
 * Two gaps closed here:
 *  1. The REST routes /api/a2a/tasks/[id] and /api/a2a/tasks/[id]/cancel had
 *     NO auth call at all — open regardless of configuration. They now share
 *     the JSON-RPC surface's authentication (REQUIRE_API_KEY posture).
 *  2. Tasks lived in an owner-less Map: any caller could read/cancel any
 *     task by id. Tasks now bind to an owner (hashed API key) at creation and
 *     reads/cancels/lists are owner-scoped. Ownerless tasks (keyless
 *     local-first posture) stay visible to everyone — by design.
 *
 * Run with:
 *   node --import tsx/esm --test tests/unit/a2a-task-owner-idor.test.ts
 */

import { after, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-a2a-idor-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "a2a-idor-test-secret";
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const { A2ATaskManager, A2A_OPERATOR_SCOPE, A2A_OWNERLESS_SCOPE, a2aOwnerScope, getTaskManager } =
  await import("../../src/lib/a2a/taskManager.ts");
const { resolveA2AOwner } = await import("../../src/lib/a2a/authenticate.ts");
const jsonRpcRoute = await import("../../src/app/a2a/route.ts");
const restList = await import("../../src/app/api/a2a/tasks/route.ts");
const restGet = await import("../../src/app/api/a2a/tasks/[id]/route.ts");
const { makeManagementSessionRequest } = await import("../helpers/managementSession.ts");

const ORIGINAL_REQUIRE = process.env.REQUIRE_API_KEY;
const ORIGINAL_OMNIROUTE_KEY = process.env.OMNIROUTE_API_KEY;
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  if (ORIGINAL_REQUIRE === undefined) delete process.env.REQUIRE_API_KEY;
  else process.env.REQUIRE_API_KEY = ORIGINAL_REQUIRE;
  if (ORIGINAL_OMNIROUTE_KEY === undefined) delete process.env.OMNIROUTE_API_KEY;
  else process.env.OMNIROUTE_API_KEY = ORIGINAL_OMNIROUTE_KEY;
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

function makeManager() {
  const tm = new A2ATaskManager(5);
  // Prevent the per-instance cleanup interval from keeping the process alive.
  clearInterval((tm as unknown as { cleanupInterval: NodeJS.Timeout }).cleanupInterval);
  return tm;
}

describe("A2ATaskManager — owner scoping (GHSA-jcm5)", () => {
  it("another principal cannot READ an owned task (same undefined as missing)", () => {
    const tm = makeManager();
    const task = tm.createTask({ skill: "smart-routing", messages: [] }, "owner-a");
    assert.equal(
      tm.getTask(task.id, a2aOwnerScope("owner-a"))?.id,
      task.id,
      "the owner still reads it"
    );
    assert.equal(
      tm.getTask(task.id, a2aOwnerScope("owner-b")),
      undefined,
      "another owner gets undefined"
    );
  });

  it("another principal cannot CANCEL an owned task (not-found error, no existence oracle)", () => {
    const tm = makeManager();
    const task = tm.createTask({ skill: "smart-routing", messages: [] }, "owner-a");
    assert.throws(() => tm.cancelTask(task.id, a2aOwnerScope("owner-b")), /not found/);
    assert.equal(
      tm.getTask(task.id, a2aOwnerScope("owner-a"))?.state,
      "submitted",
      "task untouched"
    );
    assert.equal(
      tm.cancelTask(task.id, a2aOwnerScope("owner-a")).state,
      "cancelled",
      "the owner can cancel"
    );
  });

  it("uses the same operator/owner/ownerless scope for list, get, cancel and count", () => {
    const tm = makeManager();
    const foreign = tm.createTask({ skill: "s1", messages: [] }, "owner-a");
    const mine = tm.createTask({ skill: "s1", messages: [] }, "owner-b");
    const ownerless = tm.createTask({ skill: "s1", messages: [] });
    const ownerScope = a2aOwnerScope("owner-b");

    const listed = tm.listTasks(undefined, ownerScope);
    assert.deepEqual(new Set(listed.map((t) => t.id)), new Set([ownerless.id, mine.id]));
    assert.equal(tm.countTasks(undefined, ownerScope), 2);
    assert.equal(tm.getTask(foreign.id, ownerScope), undefined);

    assert.equal(tm.listTasks(undefined, A2A_OWNERLESS_SCOPE).length, 1);
    assert.equal(tm.countTasks(undefined, A2A_OWNERLESS_SCOPE), 1);
    assert.equal(tm.getTask(mine.id, A2A_OWNERLESS_SCOPE), undefined);

    assert.equal(tm.listTasks(undefined, A2A_OPERATOR_SCOPE).length, 3);
    assert.equal(tm.countTasks(undefined, A2A_OPERATOR_SCOPE), 3);
    assert.equal(tm.getTask(foreign.id, A2A_OPERATOR_SCOPE)?.id, foreign.id);
    assert.equal(
      tm.cancelTask(foreign.id, A2A_OPERATOR_SCOPE).state,
      "cancelled",
      "operator can manage every task"
    );
  });

  it("ownerless tasks stay visible to everyone (keyless local-first posture)", () => {
    const tm = makeManager();
    const task = tm.createTask({ skill: "smart-routing", messages: [] });
    assert.equal(tm.getTask(task.id, a2aOwnerScope("anyone"))?.id, task.id);
    assert.equal(tm.getTask(task.id, A2A_OWNERLESS_SCOPE)?.id, task.id);
    assert.equal(tm.cancelTask(task.id, a2aOwnerScope("anyone")).state, "cancelled");
  });

  it("keeps the authorization owner private when tasks are serialized", () => {
    const tm = makeManager();
    const task = tm.createTask({ skill: "smart-routing", messages: [] }, "secret-owner-hash");

    assert.equal(JSON.stringify(task).includes("secret-owner-hash"), false);
    assert.equal(Object.hasOwn(task, "owner"), false);
  });
});

describe("REST /api/a2a/tasks/[id] — authentication (GHSA-jcm5)", () => {
  it("rejects an unkeyed call when REQUIRE_API_KEY=true (was: no auth at all)", async () => {
    process.env.REQUIRE_API_KEY = "true";
    delete process.env.OMNIROUTE_API_KEY;
    const res = await restGet.GET(new Request("http://localhost/api/a2a/tasks/abc") as never, {
      params: Promise.resolve({ id: "abc" }),
    });
    assert.equal(res.status, 401);
  });

  it("serves a keyed call under REQUIRE_API_KEY=true", async () => {
    process.env.REQUIRE_API_KEY = "true";
    const key = await apiKeysDb.createApiKey("a2a-rest-client", "machine-rest", []);
    const res = await restGet.GET(
      new Request("http://localhost/api/a2a/tasks/definitely-missing", {
        headers: { authorization: `Bearer ${key.key}` },
      }) as never,
      { params: Promise.resolve({ id: "definitely-missing" }) }
    );
    // Authenticated — the 404 now comes from the task lookup, not the auth gate.
    assert.equal(res.status, 404);
  });

  it("keyed caller gets 404 for another principal's task (route-level IDOR, GHSA-jcm5)", async () => {
    process.env.REQUIRE_API_KEY = "true";
    const tm = getTaskManager();
    // A task owned by a DIFFERENT principal than the caller's key hash.
    const foreign = tm.createTask({ skill: "smart-routing", messages: [] }, "some-other-owner");
    const key = await apiKeysDb.createApiKey("a2a-rest-idor", "machine-idor", []);
    const req = new Request(`http://localhost/api/a2a/tasks/${foreign.id}`, {
      headers: { authorization: `Bearer ${key.key}` },
    });
    const res = await restGet.GET(req as never, { params: Promise.resolve({ id: foreign.id }) });
    assert.equal(res.status, 404, "another principal's task is invisible");

    // And the same task IS visible to its owner (owner hash derived from the key).
    const owned = tm.createTask(
      { skill: "smart-routing", messages: [] },
      resolveA2AOwner(req as never)
    );
    const res2 = await restGet.GET(
      new Request(`http://localhost/api/a2a/tasks/${owned.id}`, {
        headers: { authorization: `Bearer ${key.key}` },
      }) as never,
      { params: Promise.resolve({ id: owned.id }) }
    );
    assert.equal(res2.status, 200, "the owner reads its own task");
  });
});

describe("A2A public surfaces — scope consistency", () => {
  it("maps a management session to operator scope", async () => {
    process.env.REQUIRE_API_KEY = "false";
    delete process.env.OMNIROUTE_API_KEY;
    await settingsDb.updateSettings({ requireLogin: true, password: "" });

    const skill = `scope-operator-${Date.now()}`;
    const tm = getTaskManager();
    const owned = tm.createTask({ skill, messages: [] }, "api-key-owner");
    const ownerless = tm.createTask({ skill, messages: [] });
    const request = await makeManagementSessionRequest(
      `http://localhost/api/a2a/tasks?skill=${encodeURIComponent(skill)}`
    );

    const response = await restList.GET(request);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { tasks: Array<{ id: string }>; total: number };
    assert.deepEqual(new Set(body.tasks.map((task) => task.id)), new Set([owned.id, ownerless.id]));
    assert.equal(body.total, 2);
  });

  it("keeps a valid API-key caller owner-scoped when requireLogin=false", async () => {
    process.env.REQUIRE_API_KEY = "false";
    delete process.env.OMNIROUTE_API_KEY;
    await settingsDb.updateSettings({ requireLogin: false });

    const key = await apiKeysDb.createApiKey("a2a-rest-default", "machine-default", []);
    const request = new Request("http://localhost/api/a2a/tasks", {
      headers: { authorization: `Bearer ${key.key}` },
    });
    const skill = `scope-default-${Date.now()}`;
    const tm = getTaskManager();
    const mine = tm.createTask({ skill, messages: [] }, resolveA2AOwner(request as never));
    const ownerless = tm.createTask({ skill, messages: [] });
    tm.createTask({ skill, messages: [] }, "foreign-owner");

    const response = await restList.GET(
      new Request(`${request.url}?skill=${encodeURIComponent(skill)}`, {
        headers: request.headers,
      })
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      tasks: Array<{ id: string; owner?: string }>;
      total: number;
    };
    assert.deepEqual(
      new Set(body.tasks.map((task) => task.id)),
      new Set([mine.id, ownerless.id]),
      "an optional-but-valid key must never be promoted to operator"
    );
    assert.equal(body.total, 2, "total must use the same owner scope as tasks[]");
    assert.equal(
      body.tasks.some((task) => Object.hasOwn(task, "owner")),
      false
    );
  });

  it("keeps the explicit A2A bearer owner-scoped across JSON-RPC and REST", async () => {
    process.env.REQUIRE_API_KEY = "false";
    process.env.OMNIROUTE_API_KEY = "explicit-a2a-cross-surface-key";
    await settingsDb.updateSettings({ requireLogin: false });

    const request = new Request("http://localhost/api/a2a/tasks", {
      headers: { authorization: `Bearer ${process.env.OMNIROUTE_API_KEY}` },
    });
    const skill = `scope-explicit-key-${Date.now()}`;
    const tm = getTaskManager();
    const mine = tm.createTask({ skill, messages: [] }, resolveA2AOwner(request as never));
    tm.createTask({ skill, messages: [] }, "foreign-owner");

    const response = await restList.GET(
      new Request(`${request.url}?skill=${encodeURIComponent(skill)}`, {
        headers: request.headers,
      })
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { tasks: Array<{ id: string }>; total: number };
    assert.deepEqual(
      body.tasks.map((task) => task.id),
      [mine.id]
    );
    assert.equal(body.total, 1);
  });

  it("keeps keyless REST callers limited to ownerless tasks", async () => {
    process.env.REQUIRE_API_KEY = "false";
    delete process.env.OMNIROUTE_API_KEY;
    await settingsDb.updateSettings({ requireLogin: false });

    const skill = `scope-keyless-rest-${Date.now()}`;
    const tm = getTaskManager();
    const ownerless = tm.createTask({ skill, messages: [] });
    tm.createTask({ skill, messages: [] }, "foreign-owner");

    const response = await restList.GET(
      new Request(`http://localhost/api/a2a/tasks?skill=${encodeURIComponent(skill)}`)
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { tasks: Array<{ id: string }>; total: number };
    assert.deepEqual(
      body.tasks.map((task) => task.id),
      [ownerless.id]
    );
    assert.equal(body.total, 1);
  });

  it("keeps keyless JSON-RPC get limited to ownerless tasks", async () => {
    process.env.REQUIRE_API_KEY = "false";
    delete process.env.OMNIROUTE_API_KEY;
    await settingsDb.updateSettings({ a2aEnabled: true });

    const tm = getTaskManager();
    const ownerless = tm.createTask({ skill: "smart-routing", messages: [] });
    const foreign = tm.createTask(
      { skill: "smart-routing", messages: [] },
      "foreign-json-rpc-owner"
    );

    const requestTask = (taskId: string) =>
      new Request("http://localhost/a2a", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tasks/get",
          params: { taskId },
        }),
      });

    const visible = await jsonRpcRoute.POST(requestTask(ownerless.id) as never);
    assert.equal(visible.status, 200);
    const visibleBody = (await visible.json()) as {
      result: { task: { id: string; owner?: string } };
    };
    assert.equal(visibleBody.result.task.id, ownerless.id);
    assert.equal(Object.hasOwn(visibleBody.result.task, "owner"), false);

    const hidden = await jsonRpcRoute.POST(requestTask(foreign.id) as never);
    assert.equal(hidden.status, 404);
    const hiddenBody = (await hidden.json()) as { error: { code: number } };
    assert.equal(hiddenBody.error.code, -32601);
  });

  it("sanitizes GET list failures instead of returning raw error.message", async () => {
    process.env.REQUIRE_API_KEY = "false";
    await settingsDb.updateSettings({ requireLogin: false });
    const tm = getTaskManager();
    const countTasks = mock.method(tm, "countTasks", () => {
      throw new Error("list failed\n    at /srv/private/a2a.ts:1:1");
    });

    try {
      const response = await restList.GET(new Request("http://localhost/api/a2a/tasks"));
      assert.equal(response.status, 500);
      const body = (await response.json()) as { error: string };
      assert.equal(body.error.includes("at /"), false);
      assert.equal(body.error.includes("/srv/private"), false);
    } finally {
      countTasks.mock.restore();
    }
  });
});
