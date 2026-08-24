import { classifyRequestComplexity } from "./autoCombo/complexityRouter.ts";
import { estimateMessageTokens } from "./specificityRules.ts";
import { detectTaskType } from "./taskAwareRouter.ts";

export type BruxoMode = "ask" | "plan" | "agent" | "multi-task" | "subagent";
export type BruxoTaskType = "coder" | "analyser" | "reviewer" | "vision" | "agentic" | "general";
export type BruxoCategory = BruxoTaskType | "agentic";
export type BruxoLevel = "mid" | "high" | "xhigh" | "max";
export type BruxoRouteSlot = BruxoLevel | "tools";
export type BruxoToolUse = "none" | "available" | "required";

type BruxoRoutes = Partial<Record<BruxoCategory, Partial<Record<BruxoRouteSlot, string>>>>;

export interface BruxoRoutingConfig {
  enabled: boolean;
  entryModels?: string[];
  fallbackCategory?: BruxoCategory;
  maxFallbackLevel?: "xhigh" | "max";
  routes?: BruxoRoutes;
  /** Optional route matrix per entry alias. Falls back to `routes` for compatibility. */
  entryRoutes?: Record<string, BruxoRoutes>;
  levelFloors?: Partial<{
    tools: BruxoLevel;
    multiTask: BruxoLevel;
    criticalRisk: BruxoLevel;
    largeContext: BruxoLevel;
  }>;
}

export interface BruxoRouteDecision {
  matched: boolean;
  category?: BruxoCategory;
  mode?: BruxoMode;
  taskType?: BruxoTaskType;
  toolUse?: BruxoToolUse;
  level?: BruxoLevel;
  resolvedCombo?: string;
  complexity?: string;
  score?: number;
  signals?: string[];
  inputTokens?: number;
  reason?: string;
  fallbackApplied?: boolean;
}

const LEVEL_ORDER: BruxoLevel[] = ["mid", "high", "xhigh", "max"];
const ROUTE_SLOTS: BruxoRouteSlot[] = ["mid", "high", "xhigh", "max", "tools"];
const DEFAULT_ENTRY_MODELS = ["bruxo"];
const DEFAULT_CONFIG: Required<Pick<BruxoRoutingConfig, "fallbackCategory" | "maxFallbackLevel">> =
  {
    fallbackCategory: "analyser",
    maxFallbackLevel: "xhigh",
  };

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeEntryModels(entryModels: unknown): string[] {
  const candidates = Array.isArray(entryModels) ? entryModels : DEFAULT_ENTRY_MODELS;
  return candidates
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isBruxoLevel(value: unknown): value is BruxoLevel {
  return typeof value === "string" && LEVEL_ORDER.includes(value as BruxoLevel);
}

function raiseLevel(level: BruxoLevel, floor: BruxoLevel | undefined): BruxoLevel {
  if (!floor || !isBruxoLevel(floor)) return level;
  return LEVEL_ORDER.indexOf(floor) > LEVEL_ORDER.indexOf(level) ? floor : level;
}

function messageText(message: unknown): string {
  const record = toRecord(message);
  const content = record.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const partRecord = toRecord(part);
      return typeof partRecord.text === "string" ? partRecord.text : "";
    })
    .join(" ");
}

function allPromptText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.map(messageText).join(" ").toLowerCase();
}

function lastUserMessage(body: Record<string, unknown>): unknown | null {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const record = toRecord(messages[i]);
    if (record.role === "user") return messages[i];
  }
  return messages.length > 0 ? messages[messages.length - 1] : null;
}

function lastUserText(body: Record<string, unknown>): string {
  const message = lastUserMessage(body);
  return message ? messageText(message).toLowerCase() : "";
}

function currentTurnMessages(
  body: Record<string, unknown>
): Array<{ role?: string; content?: unknown }> {
  const user = lastUserMessage(body);
  if (!user) return [];
  const record = toRecord(user);
  return [
    { role: typeof record.role === "string" ? record.role : "user", content: record.content },
  ];
}

function levelFromComplexity(level: string): BruxoLevel {
  if (level === "expert") return "max";
  if (level === "complex") return "xhigh";
  if (level === "moderate") return "high";
  return "mid";
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | null | undefined,
  names: string[]
): string | undefined {
  if (!headers) return undefined;
  for (const name of names) {
    const value = headers[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

function normalizeMode(value: string | undefined): BruxoMode | null {
  const mode = value?.trim().toLowerCase().replace(/_/g, "-");
  if (!mode) return null;
  if (mode === "multi-task" || mode === "multitask") return "multi-task";
  if (mode === "subagent" || mode === "sub-agent" || mode === "sub agent") return "subagent";
  if (mode === "ask" || mode === "plan" || mode === "agent") return mode;
  return null;
}

function modeFromRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string | string[] | undefined> | null
): BruxoMode {
  const explicit = normalizeMode(
    headerValue(headers, [
      "x-omniroute-mode",
      "X-OmniRoute-Mode",
      "x-omniroute-agent-mode",
      "X-OmniRoute-Agent-Mode",
      "x-omniroute-execution-mode",
      "X-OmniRoute-Execution-Mode",
    ])
  );
  if (explicit) return explicit;

  const text = `${allPromptText(body)} ${lastUserText(body)}`;
  if (/\bsub[-\s]?agent\b|\[b\]\s*subagent/.test(text)) return "subagent";
  if (/\bmulti[-\s]?task\b|\[b\]\s*multi-task/.test(text)) return "multi-task";
  if (/\bplan\b|\bplanejar\b|\bplanejamento\b/.test(text)) return "plan";
  if (/\bagent\b|\bagente\b/.test(text)) return "agent";
  if (/\bask\b|\bpergunta\b|\bperguntar\b/.test(text)) return "ask";
  return Array.isArray(body.tools) && body.tools.length > 0 ? "agent" : "ask";
}

function isReviewRequest(text: string): boolean {
  return /\b(code review|review this|review the|pull request|merge request|pr review|revis[aã]o de c[oó]digo|revisar|revise|auditar)\b/i.test(
    text
  );
}

function taskTypeFromRequest(body: Record<string, unknown>, mode: BruxoMode): BruxoTaskType {
  const detected = detectTaskType(body);
  const text = lastUserText(body);
  if (detected === "vision") return "vision";
  if (isReviewRequest(text)) return "reviewer";
  if (detected === "coding") return "coder";
  // Delegation is a semantic agentic lane. Explicit coding/review intent wins
  // so a coding subagent still reaches the coder matrix.
  if (mode === "subagent" || mode === "multi-task") return "agentic";
  if (detected === "analysis") return "analyser";
  return "general";
}

function categoryFromTaskType(taskType: BruxoTaskType): BruxoCategory {
  return taskType === "general" ? "analyser" : taskType;
}

function toolUseFromRequest(body: Record<string, unknown>, mode: BruxoMode): BruxoToolUse {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  if (!hasTools) return "none";
  return mode === "ask" || mode === "plan" ? "available" : "required";
}

function isCriticalRisk(text: string): boolean {
  return /\b(seguran[cç]a|security|migra[cç][aã]o|migration|irrevers[ií]vel|irreversible|production outage|incidente cr[ií]tico)\b/i.test(
    text
  );
}

function hasMultipleDeliverables(text: string): boolean {
  return /\b(depois|al[eé]m disso|tamb[eé]m|v[aá]rios arquivos|multiple files|tests? and|implemente.+teste|implement.+test|corrija.+teste|fix.+test)\b/i.test(
    text
  );
}

function fullInputTokens(body: Record<string, unknown>): number {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<{ role?: string; content?: unknown }>)
    : [];
  return estimateMessageTokens(messages);
}

function isLargeContext(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return fullInputTokens(body) > 64000 || messages.length > 500;
}

function isBruxoCategory(value: unknown): value is BruxoCategory {
  return (
    value === "coder" ||
    value === "agentic" ||
    value === "analyser" ||
    value === "reviewer" ||
    value === "vision" ||
    value === "general"
  );
}

function normalizeRoutes(value: unknown, entryModels: string[]): BruxoRoutes {
  const rawRoutes = toRecord(value);
  const routes: BruxoRoutes = {};
  for (const category of [
    "coder",
    "agentic",
    "analyser",
    "reviewer",
    "vision",
    "general",
  ] as const) {
    const rawCategoryRoutes = toRecord(rawRoutes[category]);
    const categoryRoutes: Partial<Record<BruxoRouteSlot, string>> = {};
    for (const slot of ROUTE_SLOTS) {
      const combo = rawCategoryRoutes[slot];
      if (
        typeof combo === "string" &&
        combo.trim() &&
        !entryModels.includes(combo.trim().toLowerCase())
      ) {
        categoryRoutes[slot] = combo.trim();
      }
    }
    if (Object.keys(categoryRoutes).length > 0) routes[category] = categoryRoutes;
  }
  return routes;
}

/** Convert an untrusted persisted settings value into safe BRUXO routing config. */
export function normalizeBruxoRoutingConfig(value: unknown): BruxoRoutingConfig | null {
  const raw = toRecord(value);
  if (raw.enabled !== true) return null;

  const entryModels = normalizeEntryModels(raw.entryModels);
  const routes = normalizeRoutes(raw.routes, entryModels);
  const entryRoutes: Record<string, BruxoRoutes> = {};
  const rawEntryRoutes = toRecord(raw.entryRoutes);
  for (const entryModel of entryModels) {
    const normalized = normalizeRoutes(rawEntryRoutes[entryModel], entryModels);
    if (Object.keys(normalized).length > 0) entryRoutes[entryModel] = normalized;
  }
  if (Object.keys(routes).length === 0 && Object.keys(entryRoutes).length === 0) return null;

  const floors = toRecord(raw.levelFloors);
  const maxFallbackLevel = raw.maxFallbackLevel === "max" ? "max" : "xhigh";
  return {
    enabled: true,
    entryModels,
    fallbackCategory: isBruxoCategory(raw.fallbackCategory)
      ? raw.fallbackCategory
      : DEFAULT_CONFIG.fallbackCategory,
    maxFallbackLevel,
    routes,
    entryRoutes,
    levelFloors: {
      tools: isBruxoLevel(floors.tools) ? floors.tools : undefined,
      multiTask: isBruxoLevel(floors.multiTask) ? floors.multiTask : undefined,
      criticalRisk: isBruxoLevel(floors.criticalRisk) ? floors.criticalRisk : undefined,
      largeContext: isBruxoLevel(floors.largeContext) ? floors.largeContext : undefined,
    },
  };
}

function resolveConfiguredCombo(
  routes: BruxoRoutes,
  category: BruxoCategory,
  slot: BruxoRouteSlot,
  maxFallbackLevel: "xhigh" | "max"
): { combo?: string; level: BruxoLevel; fallbackApplied: boolean } {
  const categoryRoutes = routes[category] ?? {};
  const direct = categoryRoutes[slot];
  if (typeof direct === "string" && direct.trim()) {
    return {
      combo: direct.trim(),
      level: slot === "tools" ? "high" : slot,
      fallbackApplied: false,
    };
  }

  if (slot === "max" && maxFallbackLevel === "xhigh") {
    const fallback = categoryRoutes.xhigh;
    if (typeof fallback === "string" && fallback.trim()) {
      return { combo: fallback.trim(), level: "xhigh", fallbackApplied: true };
    }
  }

  return { level: slot === "tools" ? "high" : slot, fallbackApplied: false };
}

function routeCategory(taskType: BruxoTaskType): BruxoCategory {
  // Tools describe execution capability, not the semantic type of the task.
  // Keep the detected task category so Agent requests can still reach coder,
  // analyser, reviewer, or agentic combos at their calculated level.
  return categoryFromTaskType(taskType);
}

function fallbackCategories(
  category: BruxoCategory,
  fallbackCategory: BruxoCategory
): BruxoCategory[] {
  const candidates = [category];
  if (category === "reviewer") candidates.push("coder", "analyser");
  if (category === "general") candidates.push("analyser");
  if (!candidates.includes(fallbackCategory)) candidates.push(fallbackCategory);
  return candidates;
}

function routeMetadata(
  body: Record<string, unknown>,
  mode: BruxoMode,
  taskType: BruxoTaskType,
  toolUse: BruxoToolUse,
  complexity: ReturnType<typeof classifyRequestComplexity>
) {
  return {
    mode,
    taskType,
    toolUse,
    complexity: complexity.level,
    score: complexity.score,
    signals: complexity.signals,
    inputTokens: fullInputTokens(body),
  };
}

/**
 * Resolve a single BRUXO entry request to a persisted specialized combo.
 * Pure: no database, network, provider, or logging side effects.
 */
export function resolveBruxoRoute(
  model: string,
  body: Record<string, unknown>,
  config: BruxoRoutingConfig | null | undefined,
  headers?: Record<string, string | string[] | undefined> | null
): BruxoRouteDecision {
  if (!config?.enabled) return { matched: false };
  const entryModels = normalizeEntryModels(config.entryModels);
  if (!entryModels.includes(model.trim().toLowerCase())) return { matched: false };

  const mode = modeFromRequest(body, headers);
  const taskType = taskTypeFromRequest(body, mode);
  const toolUse = toolUseFromRequest(body, mode);
  const complexity = classifyRequestComplexity({
    messages: currentTurnMessages(body) as never,
    model,
  });
  let level = levelFromComplexity(complexity.level);

  const levelHeader = headers?.["x-omniroute-level"] ?? headers?.["X-OmniRoute-Level"];
  if (typeof levelHeader === "string" && isBruxoLevel(levelHeader.trim().toLowerCase())) {
    level = levelHeader.trim().toLowerCase() as BruxoLevel;
  }

  const text = lastUserText(body);
  const floors = config.levelFloors ?? {};
  if (isCriticalRisk(text)) level = raiseLevel(level, floors.criticalRisk ?? "xhigh");
  if (isLargeContext(body)) level = raiseLevel(level, floors.largeContext ?? "xhigh");

  const multiTaskSignal = mode === "multi-task" || hasMultipleDeliverables(text);
  if (multiTaskSignal) level = raiseLevel(level, floors.multiTask);
  const fallbackCategory = config.fallbackCategory ?? DEFAULT_CONFIG.fallbackCategory;
  const entryModel = model.trim().toLowerCase();
  const routes = config.entryRoutes?.[entryModel] ?? config.routes ?? {};
  const category = routeCategory(taskType);
  const slot: BruxoRouteSlot = level;
  let result = resolveConfiguredCombo(
    routes,
    category,
    slot,
    config.maxFallbackLevel ?? DEFAULT_CONFIG.maxFallbackLevel
  );

  if (!result.combo) {
    // Keep old configs with only a category-level tools slot working, but never
    // prefer that legacy route while a regular category/level route exists.
    if (toolUse === "required") {
      result = resolveConfiguredCombo(
        routes,
        category,
        "tools",
        config.maxFallbackLevel ?? DEFAULT_CONFIG.maxFallbackLevel
      );
    }
  }

  if (!result.combo) {
    for (const fallback of fallbackCategories(category, fallbackCategory)) {
      if (fallback === category) continue;
      result = resolveConfiguredCombo(
        routes,
        fallback,
        slot,
        config.maxFallbackLevel ?? DEFAULT_CONFIG.maxFallbackLevel
      );
      if (!result.combo && toolUse === "required") {
        result = resolveConfiguredCombo(
          routes,
          fallback,
          "tools",
          config.maxFallbackLevel ?? DEFAULT_CONFIG.maxFallbackLevel
        );
      }
      if (result.combo) {
        return {
          matched: true,
          category: fallback,
          level: result.level,
          resolvedCombo: result.combo,
          ...routeMetadata(body, mode, taskType, toolUse, complexity),
          reason: `No ${category}-${slot} route; used ${fallback} fallback; multiTask=${multiTaskSignal}`,
          fallbackApplied: true,
        };
      }
    }
  }

  // Very old settings may have only the former global agentic-tools route.
  // Keep it as a last-resort compatibility path, after every semantic
  // category/level route has been attempted.
  if (!result.combo && toolUse === "required" && category !== "agentic") {
    result = resolveConfiguredCombo(
      routes,
      "agentic",
      "tools",
      config.maxFallbackLevel ?? DEFAULT_CONFIG.maxFallbackLevel
    );
    if (result.combo) {
      return {
        matched: true,
        category: "agentic",
        level: result.level,
        resolvedCombo: result.combo,
        ...routeMetadata(body, mode, taskType, toolUse, complexity),
        reason: `No semantic route for ${category}-${level}; used legacy agentic-tools route; multiTask=${multiTaskSignal}`,
        fallbackApplied: true,
      };
    }
  }

  if (!result.combo) {
    return {
      matched: true,
      category,
      level,
      ...routeMetadata(body, mode, taskType, toolUse, complexity),
      reason: `No configured combo for ${category}-${level}; multiTask=${multiTaskSignal}`,
      fallbackApplied: result.fallbackApplied,
    };
  }

  return {
    matched: true,
    category,
    level: result.level,
    resolvedCombo: result.combo,
    ...routeMetadata(body, mode, taskType, toolUse, complexity),
    reason: `mode=${mode}; taskType=${taskType}; routeCategory=${category}; difficulty=${level}; toolUse=${toolUse}; routeSlot=${slot}; multiTask=${multiTaskSignal}`,
    fallbackApplied: result.fallbackApplied,
  };
}
