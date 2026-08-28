import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-simulate-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../../src/lib/db/core.ts");
const combosDb = await import("../../../src/lib/db/combos.ts");
const route = await import("../../../src/app/api/playground/simulate-route/route.ts");

interface SimulationBody {
  comboName: string;
  strategy: string;
  targets: Array<{
    provider: string;
    model: string;
    rank: number;
    status: string;
  }>;
}

async function resetDb(): Promise<void> {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function simulate(comboId: string): Promise<{ response: Response; body: SimulationBody }> {
  const response = await route.POST(
    new Request("http://localhost/api/playground/simulate-route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comboId, promptTokens: 500 }),
    })
  );
  return { response, body: (await response.json()) as SimulationBody };
}

test.beforeEach(resetDb);

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("POST resolves persisted combo models into simulation targets", async () => {
  await combosDb.createCombo({
    id: "models-combo",
    name: "models-combo",
    strategy: "priority",
    models: [
      "gpt-4o",
      "openai/gpt-4o-mini",
      { provider: "anthropic", model: "claude-3-5-sonnet", weight: 25 },
    ],
  });

  const { response, body } = await simulate("models-combo");

  assert.equal(response.status, 200);
  assert.equal(body.comboName, "models-combo");
  assert.equal(body.strategy, "priority");
  assert.deepEqual(
    body.targets.map(({ provider, model, rank }) => ({ provider, model, rank })),
    [
      { provider: "unknown", model: "gpt-4o", rank: 1 },
      { provider: "openai", model: "gpt-4o-mini", rank: 2 },
      { provider: "anthropic", model: "claude-3-5-sonnet", rank: 3 },
    ]
  );
});

test("POST keeps persisted target objects compatible with simulation", async () => {
  const now = new Date().toISOString();
  core
    .getDbInstance()
    .prepare(
      "INSERT INTO combos (id, name, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      "targets-combo",
      "targets-combo",
      JSON.stringify({
        id: "targets-combo",
        name: "targets-combo",
        strategy: "weighted",
        targets: JSON.stringify([
          { provider: "openai", model: "gpt-4o", weight: 75 },
          { provider: "anthropic", model: "claude-3-5-sonnet", weight: 25 },
        ]),
      }),
      1,
      now,
      now
    );

  const { response, body } = await simulate("targets-combo");

  assert.equal(response.status, 200);
  assert.equal(body.comboName, "targets-combo");
  assert.equal(body.strategy, "weighted");
  assert.deepEqual(
    body.targets.map(({ provider, model, rank }) => ({ provider, model, rank })),
    [
      { provider: "openai", model: "gpt-4o", rank: 1 },
      { provider: "anthropic", model: "claude-3-5-sonnet", rank: 2 },
    ]
  );
});
