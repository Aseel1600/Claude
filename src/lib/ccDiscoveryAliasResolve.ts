/**
 * Request-path resolver for the `claude/…` cc-discovery aliases.
 *
 * The /v1/models catalog mirrors every enabled non-Claude model (and combo)
 * under a `claude/<id>` id so Claude Code's gateway model discovery — which only
 * lists ids starting with `claude`/`anthropic` — can surface them. When a client
 * sends one of those mirror ids back on a request, it must be resolved to the
 * real id BEFORE provider/combo resolution runs on the raw string. This module
 * is the single shared entry point for that, called from every request transport
 * that resolves a provider from the client model string:
 *   - src/sse/handlers/chat.ts (all /v1/chat, /v1/messages, /v1/responses, … )
 *   - src/app/api/internal/codex-responses-ws/route.ts (Codex Responses WS bridge)
 *
 * A legitimate `claude/<real-claude-model>` id (the actual Claude OAuth provider
 * namespace) is always left untouched — see the pure `stripCcDiscoveryAlias`.
 */
import {
  stripCcDiscoveryAlias,
  type CcDiscoveryStripResult,
} from "@omniroute/open-sse/handlers/chatCore/ccDiscoveryAliasStrip.ts";
import { getModelsByProviderId } from "@omniroute/open-sse/config/providerModels.ts";
import { getRegistryEntry } from "@omniroute/open-sse/config/providerRegistry.ts";
import { getCachedProviderNodes } from "@/lib/db/readCache";
import { getComboByName } from "@/lib/db/combos";
import {
  resolveCcAliasEnabled,
  getCcAliasGlobalState,
  getCcAliasProviderSetting,
  getCcAliasModelSetting,
  type CcAliasSetting,
} from "@/lib/db/ccDiscoveryAliases";

// Virtual provider key combos are gated under (mirrors
// src/app/api/v1/models/ccAliasPredicate.ts — combos have no real provider id,
// so the gate addresses them via this synthetic key on BOTH the catalog and the
// request side; they must match or an alias could be listed yet rejected).
const CC_DISCOVERY_COMBO_PROVIDER_KEY = "combo";
const CC_DISCOVERY_PREFIX = "claude/";

/** Injectable lookups — real implementations in {@link resolveCcDiscoveryAliasStrip}. */
export interface CcDiscoveryResolveDeps {
  /** Ids of the real "claude" OAuth provider's own models. */
  claudeModelIds: Set<string>;
  /** True when `prefix` is a built-in registry provider id or alias. */
  isRegistryProvider(prefix: string): boolean;
  /** Prefixes of operator-defined compatible provider nodes (DB) — Gap 1. */
  customProviderPrefixes: Set<string>;
  /** Combo row by name (or null). Only called for `claude/combo/<name>` ids. */
  getCombo(name: string): Promise<{ models?: unknown[] } | null>;
  gateGlobal(): boolean;
  gateProvider(providerId: string): CcAliasSetting;
  gateModel(providerId: string, modelId: string): CcAliasSetting;
}

/**
 * Testable core: resolve a `claude/…` alias to its real id using injected
 * lookups (no DB/registry access here — that lives in the production wrapper).
 */
export async function resolveCcDiscoveryAliasStripWith(
  modelStr: string | null | undefined,
  deps: CcDiscoveryResolveDeps
): Promise<CcDiscoveryStripResult> {
  if (typeof modelStr !== "string" || !modelStr.startsWith(CC_DISCOVERY_PREFIX)) {
    return { model: modelStr ?? "", stripped: false };
  }

  const rest = modelStr.slice(CC_DISCOVERY_PREFIX.length);

  // Legitimate Claude OAuth provider model — never touch it.
  if (deps.claudeModelIds.has(rest)) {
    return { model: modelStr, stripped: false };
  }

  const isComboAlias = rest.startsWith("combo/");
  const comboName = isComboAlias ? rest.slice("combo/".length) : null;
  const combo = comboName ? await deps.getCombo(comboName) : null;
  const comboExists = combo !== null && Array.isArray(combo?.models) && combo.models.length > 0;

  const slashIndex = isComboAlias ? -1 : rest.indexOf("/");
  const providerPrefix = !isComboAlias && slashIndex > 0 ? rest.slice(0, slashIndex) : null;
  const modelPart = !isComboAlias && slashIndex > 0 ? rest.slice(slashIndex + 1) : null;

  const gateProviderId = isComboAlias ? CC_DISCOVERY_COMBO_PROVIDER_KEY : providerPrefix;
  const gateEnabled = gateProviderId
    ? resolveCcAliasEnabled({
        model: isComboAlias
          ? deps.gateModel(CC_DISCOVERY_COMBO_PROVIDER_KEY, comboName as string)
          : deps.gateModel(gateProviderId, modelPart as string),
        provider: deps.gateProvider(gateProviderId),
        global: deps.gateGlobal(),
      })
    : deps.gateGlobal();

  return stripCcDiscoveryAlias(modelStr, {
    isClaudeProviderModel: (r) => deps.claudeModelIds.has(r),
    // Gap 1: recognize both built-in registry providers AND operator-defined
    // compatible nodes, matching exactly the prefixes the catalog can mirror.
    isKnownProviderPrefix: (prefix) =>
      deps.isRegistryProvider(prefix) || deps.customProviderPrefixes.has(prefix),
    hasCombo: () => comboExists,
    aliasEnabledFor: () => gateEnabled,
  });
}

/**
 * Production entry point: build the real lookups and resolve. Cheap-exit for any
 * id that does not start with `claude/` (the overwhelmingly common case) so a
 * normal request pays only a single `startsWith` check.
 */
export async function resolveCcDiscoveryAliasStrip(
  modelStr: string | null | undefined
): Promise<CcDiscoveryStripResult> {
  if (typeof modelStr !== "string" || !modelStr.startsWith(CC_DISCOVERY_PREFIX)) {
    return { model: modelStr ?? "", stripped: false };
  }

  const claudeModelIds = new Set(getModelsByProviderId("claude").map((m) => m.id));

  // Operator-defined compatible provider nodes (OpenAI/Anthropic-compatible),
  // keyed by their `prefix` — the same source catalog.ts uses to mirror them.
  const customProviderPrefixes = new Set<string>();
  try {
    const nodes = (await getCachedProviderNodes()) as Array<{ prefix?: unknown }>;
    for (const node of nodes) {
      if (typeof node?.prefix === "string" && node.prefix) {
        customProviderPrefixes.add(node.prefix);
      }
    }
  } catch {
    // A node-fetch failure just means custom prefixes are unavailable this call;
    // built-in registry providers still resolve.
  }

  const { enabled: globalEnabled } = getCcAliasGlobalState();

  return resolveCcDiscoveryAliasStripWith(modelStr, {
    claudeModelIds,
    isRegistryProvider: (prefix) => getRegistryEntry(prefix) !== null,
    customProviderPrefixes,
    getCombo: (name) => getComboByName(name),
    gateGlobal: () => globalEnabled,
    gateProvider: (providerId) => getCcAliasProviderSetting(providerId),
    gateModel: (providerId, modelId) => getCcAliasModelSetting(providerId, modelId),
  });
}
