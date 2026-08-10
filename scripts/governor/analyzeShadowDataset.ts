/** Metadata-only offline analysis. No providers, network, or LLM calls. */
import { NativeOmniGovernor } from "../../open-sse/governor/nativeGovernor.ts";
import type { GovernorInput, GovernorTelemetry } from "../../open-sse/governor/types.ts";

export type ShadowDatasetRecord = { input: GovernorInput; observation: GovernorTelemetry };

export interface ShadowAnalysis {
  TOTAL_OBSERVATIONS: number;
  EXACT_POLICY_AGREEMENTS: number;
  POLICY_DISAGREEMENTS: number;
  MODEL_TIER_DISAGREEMENTS: number;
  REASONING_DISAGREEMENTS: number;
  COMPRESSION_DISAGREEMENTS: number;
  OUTPUT_BUDGET_DISAGREEMENTS: number;
  REQUESTS_WHERE_REASONING_COULD_BE_REDUCED: number;
  REQUESTS_WHERE_OUTPUT_BUDGET_COULD_BE_REDUCED: number;
  REQUESTS_WHERE_CHEAPER_TIER_RECOMMENDED: number;
  REQUESTS_WHERE_MORE_COMPRESSION_RECOMMENDED: number;
  REQUESTS_WHERE_GOVERNOR_RECOMMENDS_STRONGER_MODEL: number;
  byTaskKind: Record<string, { total: number; disagreements: number }>;
  byActualModel: Record<string, { total: number; disagreements: number }>;
  byProvider: Record<string, { total: number; disagreements: number }>;
  byRoutingMode: Record<string, { total: number; disagreements: number }>;
}

const tierRank: Record<string, number> = { low: 0, medium: 1, high: 2, highest: 3, preserve: -1 };
function bump(map: Record<string, { total: number; disagreements: number }>, key: string, disagree: boolean) {
  const row = (map[key] ??= { total: 0, disagreements: 0 }); row.total += 1;
  if (disagree) row.disagreements += 1;
}

export function analyzeShadowDataset(records: ShadowDatasetRecord[]): ShadowAnalysis {
  const out: ShadowAnalysis = {
    TOTAL_OBSERVATIONS: records.length, EXACT_POLICY_AGREEMENTS: 0, POLICY_DISAGREEMENTS: 0,
    MODEL_TIER_DISAGREEMENTS: 0, REASONING_DISAGREEMENTS: 0, COMPRESSION_DISAGREEMENTS: 0,
    OUTPUT_BUDGET_DISAGREEMENTS: 0, REQUESTS_WHERE_REASONING_COULD_BE_REDUCED: 0,
    REQUESTS_WHERE_OUTPUT_BUDGET_COULD_BE_REDUCED: 0, REQUESTS_WHERE_CHEAPER_TIER_RECOMMENDED: 0,
    REQUESTS_WHERE_MORE_COMPRESSION_RECOMMENDED: 0, REQUESTS_WHERE_GOVERNOR_RECOMMENDS_STRONGER_MODEL: 0,
    byTaskKind: {}, byActualModel: {}, byProvider: {}, byRoutingMode: {},
  };
  const governor = new NativeOmniGovernor();
  for (const record of records) {
    const d = governor.decide(record.input);
    const r = record.observation.recommendation;
    const tier = d.modelPolicy.recommendedTier !== r.modelPolicy.recommendedTier;
    const reasoning = d.reasoningPolicy.effort !== r.reasoningPolicy.effort;
    const compression = d.compressionPolicy.mode !== r.compressionPolicy.mode;
    const output = d.maxOutputTokens !== r.maxOutputTokens;
    const disagree = tier || reasoning || compression || output || d.routingPolicy.strategy !== r.routingPolicy.strategy;
    if (disagree) out.POLICY_DISAGREEMENTS += 1; else out.EXACT_POLICY_AGREEMENTS += 1;
    if (tier) out.MODEL_TIER_DISAGREEMENTS += 1;
    if (reasoning) out.REASONING_DISAGREEMENTS += 1;
    if (compression) out.COMPRESSION_DISAGREEMENTS += 1;
    if (output) out.OUTPUT_BUDGET_DISAGREEMENTS += 1;
    const actualTier = record.observation.actualModel || "unknown";
    const recTier = r.modelPolicy.recommendedTier;
    if (actualTier !== "unknown" && tierRank[recTier] >= 0 && tierRank[recTier] < 2) out.REQUESTS_WHERE_CHEAPER_TIER_RECOMMENDED += 1;
    if ((record.observation.actualReasoningConfig ?? "none") !== "none" && r.reasoningPolicy.effort === "none") out.REQUESTS_WHERE_REASONING_COULD_BE_REDUCED += 1;
    if ((record.observation.actualCompressionConfig ?? "none") === "none" && r.compressionPolicy.mode !== "none") out.REQUESTS_WHERE_MORE_COMPRESSION_RECOMMENDED += 1;
    if (record.observation.actualModel && tierRank[recTier] > 1) out.REQUESTS_WHERE_GOVERNOR_RECOMMENDS_STRONGER_MODEL += 1;
    if (record.observation.actualModel && typeof r.maxOutputTokens === "number" && typeof record.input.requestedMaxOutput === "number" && r.maxOutputTokens < record.input.requestedMaxOutput) out.REQUESTS_WHERE_OUTPUT_BUDGET_COULD_BE_REDUCED += 1;
    bump(out.byTaskKind, record.input.taskKind ?? "unknown", disagree); bump(out.byActualModel, actualTier, disagree);
    bump(out.byProvider, record.observation.actualProvider || "unknown", disagree); bump(out.byRoutingMode, record.observation.actualRoutingStrategy || "unknown", disagree);
  }
  return out;
}
