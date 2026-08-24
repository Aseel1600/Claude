#!/usr/bin/env node
/**
 * Provision the BRUXO specialized combo matrix and routing settings.
 * Candidates are intentionally kept inside their declared type/level boundary;
 * the existing auto strategy chooses among them using health, quota, billing,
 * cost, latency, context and task-fit signals.
 *
 * Usage:
 *   node scripts/seed-bruxo-specialized-combos.mjs --dry-run
 *   node scripts/seed-bruxo-specialized-combos.mjs --apply
 *
 * DATABASE_PATH defaults to /app/data/storage.sqlite for the production container.
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const apply = process.argv.includes("--apply");
const databasePath = process.env.DATABASE_PATH ?? "/app/data/storage.sqlite";
const now = new Date().toISOString();

const weights = {
  quota: 0.14,
  health: 0.18,
  costInv: 0.06,
  latencyInv: 0.06,
  taskFit: 0.28,
  stability: 0.04,
  tierPriority: 0.03,
  tierAffinity: 0,
  specificityMatch: 0.02,
  contextAffinity: 0.03,
  cacheAffinity: 0,
  resetWindowAffinity: 0,
  connectionDensity: 0,
  billingScore: 0.16,
};

function model(id, modelName, label) {
  return { id, kind: "model", model: modelName, weight: 1, label };
}

function specializedCombo(name, description, models, strategy = "auto") {
  return {
    name,
    description,
    strategy,
    context_length: 1_000_000,
    isActive: true,
    models,
    config: {
      candidatePool: [],
      explorationRate: 0,
      complexityAwareRouting: true,
      weights,
    },
  };
}

function candidateId(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const codexMid = ["cx/gpt-5.6-luna-medium", "Codex Luna Medium"];
const codexHigh = ["cx/gpt-5.6-luna-high", "Codex Luna High"];
const codexXhigh = ["cx/gpt-5.6-luna-xhigh", "Codex Luna XHigh"];
const claudeMid = ["[VOID]/claude-haiku-4-5-20251001", "VOID Claude Haiku 4.5"];
const claudeHigh = ["claude/claude-sonnet-5", "Claude Sonnet 5"];
const kimiCode = ["kmc/kimi-for-coding", "Kimi K2.7 Code"];
const kimiHighspeed = ["kmc/kimi-for-coding-highspeed", "Kimi K2.7 Code Highspeed"];
const claudeFallback = ["claude/claude-opus-4-8", "Claude Opus 4.8 (fallback)"];
const claudeMax = ["cc/claude-opus-5", "Claude Code Opus 5"];
const verboo = ["[VB]-/deepseek-v4-flash", "Verboo DeepSeek V4 Flash"];
const voidPro = ["[VOID]/deepseek-v4-pro", "VOID DeepSeek V4 Pro"];
const geminiHigh = ["antigravity/gemini-3.6-flash-high", "Antigravity Gemini 3.6 Flash High"];
const geminiLite = ["gemini/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite"];

function candidatesFor(type, level) {
  if (level === "mid") {
    return [verboo, codexMid, geminiLite, claudeMid];
  }
  if (level === "high") {
    return [codexHigh, voidPro, geminiHigh, kimiCode, claudeMid, claudeHigh];
  }
  if (level === "xhigh") {
    return [codexXhigh, voidPro, geminiHigh, kimiHighspeed, claudeHigh];
  }
  return [claudeMax, claudeFallback];
}

const types = ["coder", "analyser", "reviewer", "agentic", "tools"];
const levels = ["mid", "high", "xhigh", "max"];
const maxEntryRoutes = {
  coder: { mid: "coder-max", high: "coder-max", xhigh: "coder-max", max: "coder-max" },
  analyser: {
    mid: "analyser-max",
    high: "analyser-max",
    xhigh: "analyser-max",
    max: "analyser-max",
  },
  reviewer: {
    mid: "reviewer-max",
    high: "reviewer-max",
    xhigh: "reviewer-max",
    max: "reviewer-max",
  },
  agentic: {
    mid: "agentic-max",
    high: "agentic-max",
    xhigh: "agentic-max",
    max: "agentic-max",
    tools: "tools-max",
  },
  tools: { mid: "tools-max", high: "tools-max", xhigh: "tools-max", max: "tools-max" },
};
const combos = types.flatMap((type) =>
  levels.map((level) => {
    const name = `${type}-${level}`;
    const models = candidatesFor(type, level).map(([modelName, label]) =>
      model(`${name}-${candidateId(label)}`, modelName, label)
    );
    const strategy = level === "max" ? "priority" : "auto";
    return specializedCombo(name, `BRUXO ${type} — ${level.toUpperCase()}`, models, strategy);
  })
);

const retiredCombos = ["agentic-tools", "agentic-free-tools"];

const bruxoRouting = {
  enabled: true,
  entryModels: ["BRUXO", "obruxo", "obruxo-free", "auto/coding", "BRUXO-MAX"],
  fallbackCategory: "analyser",
  maxFallbackLevel: "xhigh",
  routes: {
    coder: { mid: "coder-mid", high: "coder-high", xhigh: "coder-xhigh", max: "coder-max" },
    agentic: {
      mid: "agentic-mid",
      high: "agentic-high",
      xhigh: "agentic-xhigh",
      max: "agentic-max",
      tools: "tools-mid",
    },
    tools: { mid: "tools-mid", high: "tools-high", xhigh: "tools-xhigh", max: "tools-max" },
    analyser: {
      mid: "analyser-mid",
      high: "analyser-high",
      xhigh: "analyser-xhigh",
      max: "analyser-max",
    },
    reviewer: {
      mid: "reviewer-mid",
      high: "reviewer-high",
      xhigh: "reviewer-xhigh",
      max: "reviewer-max",
    },
  },
  entryRoutes: {
    // Explicit premium entry point: every semantic category is pinned to its
    // isolated MAX combo (Opus 5 -> Opus 4.8 fallback).
    "bruxo-max": maxEntryRoutes,
    // Keep clients that still send auto/coding on the free BRUXO matrix.
    "auto/coding": {
      coder: { mid: "coder-free-mid", high: "coder-free-high", xhigh: "coder-free-xhigh" },
      agentic: {
        mid: "agentic-free-mid",
        high: "agentic-free-high",
        xhigh: "agentic-free-xhigh",
        tools: "tools-free-mid",
      },
      analyser: {
        mid: "analyser-free-mid",
        high: "analyser-free-high",
        xhigh: "analyser-free-xhigh",
      },
      reviewer: {
        mid: "analyser-free-mid",
        high: "analyser-free-high",
        xhigh: "analyser-free-xhigh",
      },
      tools: { mid: "tools-free-mid", high: "tools-free-high", xhigh: "tools-free-xhigh" },
    },
    "obruxo-free": {
      coder: { mid: "coder-free-mid", high: "coder-free-high", xhigh: "coder-free-xhigh" },
      agentic: {
        mid: "agentic-free-mid",
        high: "agentic-free-high",
        xhigh: "agentic-free-xhigh",
        tools: "agentic-free-tools",
      },
      analyser: {
        mid: "analyser-free-mid",
        high: "analyser-free-high",
        xhigh: "analyser-free-xhigh",
      },
    },
  },
  // Tools are a capability filter, not a semantic difficulty floor. A simple
  // file read can remain MID; only the request's type/complexity raises level.
  levelFloors: { multiTask: "xhigh", criticalRisk: "xhigh", largeContext: "xhigh" },
};

console.log(`BRUXO specialized matrix (${apply ? "APPLY" : "DRY RUN"})`);
for (const combo of combos)
  console.log(`- ${combo.name}: ${combo.models.map((step) => step.model).join(", ")}`);
console.log(`- settings.bruxoRouting.enabled: ${bruxoRouting.enabled}`);

if (!apply) process.exit(0);

const db = new Database(databasePath);
const existing = db.prepare("SELECT id, data FROM combos WHERE name = ?");
const insert = db.prepare(
  "INSERT INTO combos (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
);
const update = db.prepare("UPDATE combos SET data = ?, updated_at = ? WHERE name = ?");
const saveSetting = db.prepare(
  "INSERT INTO key_value (namespace, key, value) VALUES ('settings', 'bruxoRouting', ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value"
);

db.transaction(() => {
  for (const combo of combos) {
    const row = existing.get(combo.name);
    const data = JSON.stringify(combo);
    if (row) update.run(data, now, combo.name);
    else insert.run(randomUUID(), combo.name, data, now, now);
  }
  for (const name of retiredCombos) {
    const row = existing.get(name);
    if (!row) continue;
    const retired = JSON.parse(row.data);
    retired.isActive = false;
    retired.updatedAt = now;
    update.run(JSON.stringify(retired), now, name);
  }
  saveSetting.run(JSON.stringify(bruxoRouting));
})();

db.close();
console.log("BRUXO specialized combos and routing settings provisioned.");
