#!/usr/bin/env node
/**
 * Create or update the obruxo-free priority combo from the validated two-pass
 * no-cache latency benchmark performed on 2026-08-23.
 *
 * Usage inside the production container:
 *   DATABASE_PATH=/app/data/storage.sqlite node /app/seed-obruxo-free-combo.mjs --apply
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const apply = process.argv.includes("--apply");
const databasePath = process.env.DATABASE_PATH ?? "/app/data/storage.sqlite";
const now = new Date().toISOString();

const rankedModels = [
  ["[VB]-/deepseek-v4-flash", "Verboo DeepSeek V4 Flash", 1],
  ["[VOID]/deepseek-v4-pro", "VOID DeepSeek V4 Pro", 2],
  ["antigravity/gemini-3.6-flash-medium", "Antigravity Gemini 3.6 Flash Medium", 3],
  ["gemini/gemini-3.5-flash", "Gemini 3.5 Flash", 4],
  ["gemini/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", 5],
];

const combo = {
  name: "obruxo-free",
  description:
    "Obruxo Free — pool priorizado pelo benchmark sem cache de 2026-08-23; Gemini 3.6 Flash principal com fallbacks DeepSeek, Gemini, Verboo e Cursor Auto.",
  strategy: "priority",
  context_length: 1_000_000,
  isActive: true,
  models: rankedModels.map(([model, label, priority], index) => ({
    id: `obruxo-free-${index + 1}`,
    kind: "model",
    model,
    label,
    priority,
    weight: 0,
  })),
  config: {},
  version: 1,
  updatedAt: now,
};

if (!apply) {
  console.log(JSON.stringify(combo, null, 2));
  console.log("\nDry run only; pass --apply to write the combo.");
  process.exit(0);
}

const db = new Database(databasePath);
const row = db.prepare("SELECT id, data, created_at FROM combos WHERE name = ?").get(combo.name);
const id = row?.id ?? randomUUID();
const createdAt = row?.created_at ?? now;
const previous = row?.data ? JSON.parse(row.data) : null;
combo.id = id;
combo.createdAt = previous?.createdAt ?? createdAt;
combo.version = Number(previous?.version ?? 0) + 1;

if (row) {
  db.prepare("UPDATE combos SET data = ?, updated_at = ? WHERE name = ?").run(
    JSON.stringify(combo),
    now,
    combo.name
  );
  console.log(`Updated ${combo.name} (${id}) to version ${combo.version}.`);
} else {
  db.prepare(
    "INSERT INTO combos (id, name, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, combo.name, JSON.stringify(combo), 1, createdAt, now);
  console.log(`Created ${combo.name} (${id}) version ${combo.version}.`);
}

db.close();
