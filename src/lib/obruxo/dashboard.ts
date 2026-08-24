import { getDbInstance } from "@/lib/db/core";
import { getCombos, getSettings, getSettingsRevision } from "@/lib/localDb";
import { getAllComboMetrics } from "@omniroute/open-sse/services/comboMetrics.ts";
import { toNumber } from "@/shared/utils/numeric";
import {
  normalizeBruxoRoutingConfig,
  type BruxoCategory,
  type BruxoLevel,
  type BruxoRoutingConfig,
} from "@omniroute/open-sse/services/bruxoMasterRouter.ts";

export const OBRUXO_TYPES = ["coder", "analyser", "reviewer", "agentic", "tools"] as const;
export const OBRUXO_LEVELS = ["mid", "high", "xhigh", "max"] as const;
export const OBRUXO_MODES = ["bruxo", "obruxo", "obruxo-free", "bruxo-max", "auto/coding"] as const;

export type ObruxoType = (typeof OBRUXO_TYPES)[number];
export type ObruxoLevel = (typeof OBRUXO_LEVELS)[number];
export type ObruxoMode = (typeof OBRUXO_MODES)[number] | string;

type JsonRecord = Record<string, unknown>;
type GroupValue = { count: number; success: number; errors: number; tokens: number; cost: number };

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function normalizeMode(value: unknown): ObruxoMode {
  const model = toString(value, "unknown").toLowerCase();
  if (model.includes("obruxo-free")) return "obruxo-free";
  if (model.includes("bruxo-max")) return "bruxo-max";
  if (model.includes("auto/coding")) return "auto/coding";
  if (model === "bruxo" || model === "obruxo") return model;
  return "direct";
}

function modelFromStep(step: unknown): string {
  if (typeof step === "string") return step;
  if (!isRecord(step)) return "";
  return toString(step.model ?? step.modelStr ?? step.targetModel);
}

function providerFromModel(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "unknown";
}

function collectComboNames(config: BruxoRoutingConfig): Set<string> {
  const names = new Set<string>();
  const collectRoutes = (routes: unknown) => {
    if (!isRecord(routes)) return;
    for (const category of Object.values(routes)) {
      if (!isRecord(category)) continue;
      for (const combo of Object.values(category)) {
        const value = toString(combo).toLowerCase();
        if (value) names.add(value);
      }
    }
  };
  collectRoutes(config.routes);
  for (const routes of Object.values(config.entryRoutes ?? {})) collectRoutes(routes);
  return names;
}

function buildComboView(combo: JsonRecord, metrics: Record<string, unknown>) {
  const name = toString(combo.name, "unknown");
  const models = Array.isArray(combo.models) ? combo.models : [];
  const modelViews = models
    .map((step) => {
      const model = modelFromStep(step);
      if (!model) return null;
      const record = isRecord(step) ? step : {};
      return {
        id: toString(record.id, `${name}-${model}`),
        model,
        provider: toString(record.provider, providerFromModel(model)),
        label: toString(record.label, model),
        weight: toNumber(record.weight, 1),
        enabled: record.enabled !== false,
      };
    })
    .filter(Boolean);

  const metric = isRecord(metrics[name]) ? metrics[name] : {};
  return {
    id: toString(combo.id, name),
    name,
    description: toString(combo.description),
    strategy: toString(combo.strategy, "auto"),
    isActive: combo.isActive !== false,
    contextLength: toNumber(combo.context_length ?? combo.contextLength, 0),
    models: modelViews,
    metrics: {
      totalRequests: toNumber(metric.totalRequests),
      totalSuccesses: toNumber(metric.totalSuccesses),
      totalFailures: toNumber(metric.totalFailures),
      totalFallbacks: toNumber(metric.totalFallbacks),
      avgLatencyMs: toNumber(metric.avgLatencyMs),
      successRate: toNumber(metric.successRate),
      lastUsedAt: metric.lastUsedAt ?? null,
    },
  };
}

export async function getObruxoConfigPayload() {
  const settings = await getSettings();
  const revision = await getSettingsRevision();
  const config = normalizeBruxoRoutingConfig(settings.bruxoRouting);
  const combos = await getCombos();
  const comboMetrics = getAllComboMetrics() as Record<string, unknown>;

  if (!config) {
    return {
      enabled: false,
      config: null,
      combos: [],
      revision,
      generatedAt: new Date().toISOString(),
    };
  }

  const names = collectComboNames(config);
  const comboViews = combos
    .filter((combo) => names.has(toString(combo.name).toLowerCase()))
    .map((combo) => buildComboView(combo, comboMetrics));

  return {
    enabled: true,
    config,
    combos: comboViews,
    revision,
    generatedAt: new Date().toISOString(),
  };
}

function getRangeStart(range: string): string | null {
  if (range === "all") return null;
  const days = range === "24h" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function incrementGroup(groups: Map<string, GroupValue>, key: string, row: JsonRecord) {
  const current = groups.get(key) ?? { count: 0, success: 0, errors: 0, tokens: 0, cost: 0 };
  current.count += 1;
  if (row.success === 1 || row.status === "200") current.success += 1;
  if (row.success === 0 || (typeof row.status === "string" && row.status !== "200"))
    current.errors += 1;
  current.tokens +=
    toNumber(row.tokens_input ?? row.input_tokens_estimated) + toNumber(row.tokens_output);
  current.cost += toNumber(row.estimated_cost_usd);
  groups.set(key, current);
}

function groupsToRows(groups: Map<string, GroupValue>) {
  return [...groups.entries()]
    .map(([name, value]) => ({
      name,
      ...value,
      successRate: value.count > 0 ? value.success / value.count : 0,
      share: 0,
    }))
    .sort((a, b) => b.count - a.count);
}

function applyShares<T extends { count: number; share: number }>(rows: T[]) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows.map((row) => ({ ...row, share: total > 0 ? row.count / total : 0 }));
}

export async function getObruxoAnalytics(searchParams: URLSearchParams) {
  const settings = await getSettings();
  const config = normalizeBruxoRoutingConfig(settings.bruxoRouting);
  const entryModels = new Set((config?.entryModels ?? []).map((model) => model.toLowerCase()));
  const range = searchParams.get("range") || "24h";
  const start = getRangeStart(range);
  const db = getDbInstance();

  const where = start ? "WHERE timestamp >= ?" : "";
  const params = start ? [start] : [];
  const observations = db
    .prepare(
      `SELECT timestamp, requested_model, resolved_model, resolved_combo, task_type, category,
              difficulty, complexity, score, input_tokens_estimated, selected_provider,
              selected_model, status, success, latency_ms, ttft_ms, tokens_input,
              tokens_output, tokens_cache_read, estimated_cost_usd, fallback_count
         FROM routing_observations ${where} ORDER BY timestamp DESC LIMIT 50000`
    )
    .all(...params) as JsonRecord[];

  const routeRows = observations.filter((row) => {
    const requested = toString(row.requested_model).toLowerCase();
    return entryModels.size === 0 || entryModels.has(requested);
  });

  const typeFilter = searchParams.get("type");
  const levelFilter = searchParams.get("level");
  const modeFilter = searchParams.get("mode");
  const filtered = routeRows.filter((row) => {
    const type = toString(row.category || row.task_type, "general").toLowerCase();
    const level = toString(row.difficulty, "mid").toLowerCase();
    const mode = normalizeMode(row.requested_model);
    return (
      (!typeFilter || type === typeFilter) &&
      (!levelFilter || level === levelFilter) &&
      (!modeFilter || mode === modeFilter)
    );
  });

  const byType = new Map<string, GroupValue>();
  const byLevel = new Map<string, GroupValue>();
  const byMode = new Map<string, GroupValue>();
  const byCombo = new Map<string, GroupValue>();
  const byModel = new Map<string, GroupValue>();
  const latencies: number[] = [];
  let successes = 0;
  let errors = 0;
  let fallbacks = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let estimatedCostUsd = 0;
  let simplePromoted = 0;

  for (const row of filtered) {
    const type = toString(row.category || row.task_type, "general").toLowerCase();
    const level = toString(row.difficulty, "mid").toLowerCase();
    const mode = normalizeMode(row.requested_model);
    const combo = toString(row.resolved_combo || row.resolved_model, "unresolved");
    const model = toString(row.selected_model || row.resolved_model, "unresolved");
    incrementGroup(byType, type, row);
    incrementGroup(byLevel, level, row);
    incrementGroup(byMode, mode, row);
    incrementGroup(byCombo, combo, row);
    if (
      model !== combo &&
      !model.endsWith("-mid") &&
      !model.endsWith("-high") &&
      !model.endsWith("-xhigh") &&
      !model.endsWith("-max")
    ) {
      incrementGroup(byModel, model, row);
    }
    if (row.success === 1 || row.status === "200") successes += 1;
    if (row.success === 0 || (typeof row.status === "string" && row.status !== "200")) errors += 1;
    fallbacks += toNumber(row.fallback_count);
    inputTokens += toNumber(row.tokens_input ?? row.input_tokens_estimated);
    outputTokens += toNumber(row.tokens_output);
    cacheReadTokens += toNumber(row.tokens_cache_read);
    estimatedCostUsd += toNumber(row.estimated_cost_usd);
    const latency = toNumber(row.latency_ms);
    if (latency > 0) latencies.push(latency);
    if (row.complexity === "simple" && level === "xhigh") simplePromoted += 1;
  }

  const allCalls = db
    .prepare(
      `SELECT model, provider, combo_name, status, duration, tokens_in, tokens_out, timestamp
         FROM call_logs ${where} ORDER BY timestamp DESC LIMIT 50000`
    )
    .all(...params) as JsonRecord[];
  const comboNames = new Set([...byCombo.keys()].map((name) => name.toLowerCase()));
  const executionCalls = allCalls.filter((row) => {
    const combo = toString(row.combo_name).toLowerCase();
    return (
      comboNames.has(combo) ||
      combo.startsWith("coder-") ||
      combo.startsWith("analyser-") ||
      combo.startsWith("reviewer-") ||
      combo.startsWith("agentic-") ||
      combo.startsWith("tools-")
    );
  });
  const executionByModel = new Map<string, JsonRecord>();
  for (const row of executionCalls) {
    const model = toString(row.model, "unknown");
    const current = executionByModel.get(model) ?? {
      count: 0,
      success: 0,
      errors: 0,
      tokens: 0,
      avgLatencyMs: 0,
    };
    current.count = toNumber(current.count) + 1;
    if (toNumber(row.status) >= 200 && toNumber(row.status) < 300)
      current.success = toNumber(current.success) + 1;
    else current.errors = toNumber(current.errors) + 1;
    current.tokens = toNumber(current.tokens) + toNumber(row.tokens_in) + toNumber(row.tokens_out);
    current.avgLatencyMs = toNumber(current.avgLatencyMs) + toNumber(row.duration);
    executionByModel.set(model, current);
  }
  const executionModels = [...executionByModel.entries()]
    .map(([name, value]) => ({
      name,
      count: toNumber(value.count),
      success: toNumber(value.success),
      errors: toNumber(value.errors),
      tokens: toNumber(value.tokens),
      avgLatencyMs: toNumber(value.avgLatencyMs) / Math.max(1, toNumber(value.count)),
    }))
    .sort((a, b) => toNumber(b.count) - toNumber(a.count));

  const typeRows = applyShares(groupsToRows(byType));
  const levelRows = applyShares(groupsToRows(byLevel));
  const modeRows = applyShares(groupsToRows(byMode));
  const comboRows = applyShares(groupsToRows(byCombo));
  const modelRows =
    executionModels.length > 0 ? executionModels : applyShares(groupsToRows(byModel));
  const requestCount = filtered.length;

  return {
    generatedAt: new Date().toISOString(),
    range,
    totals: {
      requests: requestCount,
      executionCalls: executionCalls.length,
      successes,
      errors,
      successRate: requestCount > 0 ? successes / requestCount : 0,
      fallbacks,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      estimatedCostUsd,
      avgLatencyMs:
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p95LatencyMs: percentile(latencies, 0.95),
    },
    byType: typeRows,
    byLevel: levelRows,
    byMode: modeRows,
    byCombo: comboRows,
    byModel: modelRows,
    anomalies: [
      ...(requestCount > 0 && !levelRows.some((row) => row.name === "mid")
        ? [
            {
              severity: "warning",
              code: "mid_unused",
              message: "MID ainda nao recebeu chamadas neste periodo.",
            },
          ]
        : []),
      ...(requestCount > 0 && levelRows.some((row) => row.name === "max" && row.share > 0.15)
        ? [
            {
              severity: "warning",
              code: "max_overused",
              message: "MAX esta acima de 15% das decisoes.",
            },
          ]
        : []),
      ...(simplePromoted > 0
        ? [
            {
              severity: "info",
              code: "simple_promoted",
              message: `${simplePromoted} requisicoes simples chegaram a XHIGH.`,
            },
          ]
        : []),
      ...(errors > 0
        ? [
            {
              severity: "error",
              code: "routing_errors",
              message: `${errors} decisoes terminaram com erro.`,
            },
          ]
        : []),
    ],
    recent: filtered.slice(0, 30).map((row) => ({
      timestamp: row.timestamp,
      requestedModel: row.requested_model,
      mode: normalizeMode(row.requested_model),
      type: toString(row.category || row.task_type, "general"),
      level: toString(row.difficulty, "mid"),
      complexity: row.complexity ?? null,
      score: row.score ?? null,
      combo: row.resolved_combo || row.resolved_model || null,
      model: row.selected_model || null,
      provider: row.selected_provider || null,
      status: row.status || (row.success === 1 ? "200" : "routed"),
      fallbackCount: toNumber(row.fallback_count),
      inputTokens: toNumber(row.tokens_input ?? row.input_tokens_estimated),
      outputTokens: toNumber(row.tokens_output),
    })),
  };
}

export function validateObruxoConfigReferences(
  config: BruxoRoutingConfig,
  comboNames: Set<string>
) {
  const allowed = new Set([...comboNames].map((name) => name.toLowerCase()));
  const entryModels = new Set(config.entryModels.map((model) => model.toLowerCase()));
  const invalid: string[] = [];
  const visit = (routes: unknown) => {
    if (!isRecord(routes)) return;
    for (const category of Object.values(routes)) {
      if (!isRecord(category)) continue;
      for (const value of Object.values(category)) {
        const name = toString(value);
        if (!name) continue;
        const lower = name.toLowerCase();
        if (!allowed.has(lower) && !entryModels.has(lower) && !invalid.includes(name))
          invalid.push(name);
      }
    }
  };
  visit(config.routes);
  for (const routes of Object.values(config.entryRoutes ?? {})) visit(routes);
  return invalid;
}

export function asObruxoType(value: string): ObruxoType | null {
  return (OBRUXO_TYPES as readonly string[]).includes(value) ? (value as ObruxoType) : null;
}

export function asObruxoLevel(value: string): ObruxoLevel | null {
  return (OBRUXO_LEVELS as readonly string[]).includes(value) ? (value as ObruxoLevel) : null;
}

export type { BruxoCategory, BruxoLevel, BruxoRoutingConfig };
