#!/usr/bin/env node
/** Provision the intelligent obruxo-free matrix and dual-entry BRUXO routing. */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const apply = process.argv.includes("--apply");
const databasePath = process.env.DATABASE_PATH ?? "/app/data/storage.sqlite";
const now = new Date().toISOString();

const pools = {
  fast: [
    ["[VB]-/deepseek-v4-flash", "Verboo DeepSeek V4 Flash"],
    ["[VOID]/claude-haiku-4-5-20251001", "VOID Claude Haiku 4.5"],
    ["antigravity/gemini-3.6-flash-medium", "Antigravity Gemini 3.6 Flash Medium"],
    ["gemini/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite"],
    ["gemini/gemini-3.5-flash", "Gemini 3.5 Flash"],
  ],
  deep: [
    ["[VB]-/deepseek-v4-flash", "Verboo DeepSeek V4 Flash"],
    ["[VOID]/deepseek-v4-pro", "VOID DeepSeek V4 Pro"],
    ["antigravity/gemini-3.6-flash-high", "Antigravity Gemini 3.6 Flash High"],
    ["gemini/gemini-3.5-flash", "Gemini 3.5 Flash"],
    ["antigravity/gemini-3.6-flash-medium", "Antigravity Gemini 3.6 Flash Medium"],
  ],
  agentic: [
    ["[VB]-/deepseek-v4-flash", "Verboo DeepSeek V4 Flash"],
    ["[VOID]/deepseek-v4-pro", "VOID DeepSeek V4 Pro"],
    ["antigravity/gemini-3.6-flash-high", "Antigravity Gemini 3.6 Flash High"],
    ["gemini/gemini-3.5-flash", "Gemini 3.5 Flash"],
    ["antigravity/gemini-3.6-flash-medium", "Antigravity Gemini 3.6 Flash Medium"],
  ],
};

function combo(name, description, pool) {
  return {
    name,
    description,
    strategy: "priority",
    context_length: 1_000_000,
    isActive: true,
    models: pool.map(([model, label], index) => ({
      id: `${name}-${index + 1}`,
      kind: "model",
      model,
      label,
      priority: index + 1,
      weight: 0,
    })),
    config: {},
    version: 1,
    updatedAt: now,
  };
}

const combos = [
  combo("coder-free-mid", "BRUXO Free Coder — MID, velocidade e edição", pools.fast),
  combo("coder-free-high", "BRUXO Free Coder — HIGH, DeepSeek e Gemini", pools.deep),
  combo(
    "coder-free-xhigh",
    "BRUXO Free Coder — XHIGH, melhor pool gratuito disponível",
    pools.deep
  ),
  combo("agentic-free-mid", "BRUXO Free Agentic — MID, tools e velocidade", pools.agentic),
  combo(
    "agentic-free-high",
    "BRUXO Free Agentic — HIGH, tools com fallback robusto",
    pools.agentic
  ),
  combo("agentic-free-xhigh", "BRUXO Free Agentic — XHIGH, tools e análise profunda", pools.deep),
  combo("tools-free-mid", "BRUXO Free Tools — MID", pools.fast),
  combo("tools-free-high", "BRUXO Free Tools — HIGH", pools.deep),
  combo("tools-free-xhigh", "BRUXO Free Tools — XHIGH", pools.deep),
  combo("analyser-free-mid", "BRUXO Free Analyser — MID", pools.fast),
  combo("analyser-free-high", "BRUXO Free Analyser — HIGH", pools.deep),
  combo("analyser-free-xhigh", "BRUXO Free Analyser — XHIGH", pools.deep),
];

const freeRoutes = {
  coder: { mid: "coder-free-mid", high: "coder-free-high", xhigh: "coder-free-xhigh" },
  agentic: {
    mid: "agentic-free-mid",
    high: "agentic-free-high",
    xhigh: "agentic-free-xhigh",
    tools: "tools-free-mid",
  },
  tools: { mid: "tools-free-mid", high: "tools-free-high", xhigh: "tools-free-xhigh" },
  analyser: { mid: "analyser-free-mid", high: "analyser-free-high", xhigh: "analyser-free-xhigh" },
};

console.log(`BRUXO Free specialized matrix (${apply ? "APPLY" : "DRY RUN"})`);
for (const item of combos) console.log(`- ${item.name}: ${item.models.length} models`);
if (!apply) process.exit(0);

const db = new Database(databasePath);
const currentSetting = db
  .prepare("SELECT value FROM key_value WHERE namespace = 'settings' AND key = 'bruxoRouting'")
  .get();
const routing = currentSetting?.value ? JSON.parse(currentSetting.value) : {};
routing.enabled = true;
routing.entryModels = Array.from(new Set([...(routing.entryModels ?? ["BRUXO"]), "obruxo-free"]));
routing.entryRoutes = { ...(routing.entryRoutes ?? {}), "obruxo-free": freeRoutes };
routing.fallbackCategory ??= "analyser";
routing.maxFallbackLevel ??= "xhigh";
routing.levelFloors = { ...(routing.levelFloors ?? {}) };
delete routing.levelFloors.tools;
routing.levelFloors.multiTask ??= "xhigh";
routing.levelFloors.criticalRisk ??= "xhigh";
routing.levelFloors.largeContext ??= "xhigh";

const existing = db.prepare("SELECT id, data, created_at FROM combos WHERE name = ?");
const insert = db.prepare(
  "INSERT INTO combos (id, name, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const update = db.prepare("UPDATE combos SET data = ?, updated_at = ? WHERE name = ?");
const saveSetting = db.prepare(
  "INSERT INTO key_value (namespace, key, value) VALUES ('settings', 'bruxoRouting', ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value"
);

db.transaction(() => {
  for (const item of combos) {
    const row = existing.get(item.name);
    const previous = row?.data ? JSON.parse(row.data) : null;
    item.id = row?.id ?? randomUUID();
    item.createdAt = previous?.createdAt ?? row?.created_at ?? now;
    item.version = Number(previous?.version ?? 0) + 1;
    if (row) update.run(JSON.stringify(item), now, item.name);
    else insert.run(item.id, item.name, JSON.stringify(item), 1, item.createdAt, now);
  }
  saveSetting.run(JSON.stringify(routing));
})();

db.close();
console.log("BRUXO Free matrix and dual-entry routing provisioned.");
