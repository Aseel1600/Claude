#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseFlag(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function resolveDbPath() {
  const explicit = parseFlag("--db", null);
  const candidates = [
    explicit,
    process.env.OMNIROUTE_OBSERVABILITY_DB,
    process.env.OMNIROUTE_DB_PATH,
    path.join(process.cwd(), "data", "storage.sqlite"),
    "/var/lib/docker/volumes/omniroute-prod-data/_data/storage.sqlite",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  throw new Error(`No SQLite database found. Pass --db /path/to/storage.sqlite`);
}

function formatNumber(value, digits = 0) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function printRows(title, rows, columns) {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("  no rows");
    return;
  }
  const widths = columns.map((column) =>
    Math.max(
      column.label.length,
      ...rows.map(
        (row) =>
          String(column.format ? column.format(row[column.key]) : (row[column.key] ?? "")).length
      )
    )
  );
  console.log(columns.map((column, idx) => column.label.padEnd(widths[idx])).join("  "));
  console.log(columns.map((_, idx) => "-".repeat(widths[idx])).join("  "));
  for (const row of rows) {
    console.log(
      columns
        .map((column, idx) =>
          String(column.format ? column.format(row[column.key]) : (row[column.key] ?? "")).padEnd(
            widths[idx]
          )
        )
        .join("  ")
    );
  }
}

const hours = Math.max(1, Number.parseInt(parseFlag("--hours", "24"), 10) || 24);
const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const dbPath = resolveDbPath();
const { default: Database } = await import("better-sqlite3");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const hasRoutingObservations = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'routing_observations'")
  .get();

console.log(`Routing observability report`);
console.log(`db: ${dbPath}`);
console.log(`window: last ${hours}h since ${since}`);

if (!hasRoutingObservations) {
  console.log("\nrouting_observations table does not exist yet. Deploy migration 135 first.");
  process.exit(0);
}

const summary = db
  .prepare(
    `
    SELECT
      COUNT(*) AS requests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
      ROUND(100.0 * AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END), 1) AS success_pct,
      ROUND(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) AS avg_latency_ms,
      ROUND(SUM(COALESCE(estimated_cost_usd, 0)), 6) AS estimated_cost_usd,
      ROUND(AVG(COALESCE(estimated_cost_usd, 0)), 6) AS avg_cost_usd,
      SUM(COALESCE(tokens_input, 0)) AS tokens_input,
      SUM(COALESCE(tokens_output, 0)) AS tokens_output,
      ROUND(AVG(COALESCE(tokens_input, 0)), 0) AS avg_input_tok,
      ROUND(AVG(COALESCE(tokens_output, 0)), 0) AS avg_output_tok,
      ROUND(AVG(COALESCE(tokens_reasoning, 0)), 0) AS avg_reasoning_tok
    FROM routing_observations
    WHERE timestamp >= @since
  `
  )
  .get({ since });

printRows(
  "Summary",
  [summary],
  [
    { key: "requests", label: "requests", format: (v) => formatNumber(v) },
    { key: "ok", label: "ok", format: (v) => formatNumber(v) },
    { key: "failed", label: "failed", format: (v) => formatNumber(v) },
    { key: "success_pct", label: "ok_%", format: (v) => formatNumber(v, 1) },
    { key: "avg_latency_ms", label: "avg_ms", format: (v) => formatNumber(v) },
    { key: "estimated_cost_usd", label: "cost_usd", format: (v) => formatNumber(v, 6) },
    { key: "avg_cost_usd", label: "avg_cost", format: (v) => formatNumber(v, 6) },
    { key: "tokens_input", label: "input_tok", format: (v) => formatNumber(v) },
    { key: "tokens_output", label: "output_tok", format: (v) => formatNumber(v) },
    { key: "avg_input_tok", label: "avg_in", format: (v) => formatNumber(v) },
    { key: "avg_output_tok", label: "avg_out", format: (v) => formatNumber(v) },
    { key: "avg_reasoning_tok", label: "avg_reason", format: (v) => formatNumber(v) },
  ]
);

const groupColumns = [
  { key: "requests", label: "requests", format: (v) => formatNumber(v) },
  { key: "success_pct", label: "ok_%", format: (v) => formatNumber(v, 1) },
  { key: "avg_latency_ms", label: "avg_ms", format: (v) => formatNumber(v) },
  { key: "avg_input_tok", label: "avg_in", format: (v) => formatNumber(v) },
  { key: "avg_output_tok", label: "avg_out", format: (v) => formatNumber(v) },
  { key: "avg_reasoning_tok", label: "avg_reason", format: (v) => formatNumber(v) },
  { key: "avg_cost_usd", label: "avg_cost", format: (v) => formatNumber(v, 6) },
  { key: "estimated_cost_usd", label: "cost_usd", format: (v) => formatNumber(v, 6) },
];

function groupBy(title, selectExpr, keyLabel, limit = 15) {
  const rows = db
    .prepare(
      `
      SELECT
        COALESCE(${selectExpr}, '-') AS bucket,
        COUNT(*) AS requests,
        ROUND(100.0 * AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END), 1) AS success_pct,
        ROUND(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) AS avg_latency_ms,
        ROUND(AVG(COALESCE(tokens_input, 0)), 0) AS avg_input_tok,
        ROUND(AVG(COALESCE(tokens_output, 0)), 0) AS avg_output_tok,
        ROUND(AVG(COALESCE(tokens_reasoning, 0)), 0) AS avg_reasoning_tok,
        ROUND(AVG(COALESCE(estimated_cost_usd, 0)), 6) AS avg_cost_usd,
        ROUND(SUM(COALESCE(estimated_cost_usd, 0)), 6) AS estimated_cost_usd
      FROM routing_observations
      WHERE timestamp >= @since
      GROUP BY bucket
      ORDER BY requests DESC
      LIMIT ${limit}
    `
    )
    .all({ since });
  printRows(title, rows, [{ key: "bucket", label: keyLabel }, ...groupColumns]);
}

groupBy("By requested model", "requested_model", "model");
groupBy("By mode", "mode", "mode");
groupBy(
  "By type/level",
  "COALESCE(category, task_type, '-') || '/' || COALESCE(difficulty, '-')",
  "type_level"
);
groupBy("By lane/tools", "lane || '/' || tool_use", "lane");
groupBy("By resolved combo", "resolved_combo", "combo", 20);
groupBy(
  "By selected provider/model",
  "selected_provider || '/' || selected_model",
  "provider_model",
  20
);

db.close();
