/**
 * The adaptive context budget must respect a known input ceiling.
 *
 * `reserve-output` estimates the prompt budget as (total window − configured
 * reserve − margin). That is right when nothing better is known, and wrong when
 * the catalog states the real input limit: a 400k window minus a 4k reserve
 * targets 396k on a model whose actual input ceiling is 272k (#6191), so
 * compression "succeeds" straight into an upstream rejection.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  capToInputCeiling,
  resolveAdaptivePlan,
} from "../../../open-sse/services/compression/adaptiveCompression/resolveAdaptivePlan.ts";
import { DEFAULT_CONTEXT_BUDGET } from "../../../open-sse/services/compression/adaptiveCompression/types.ts";

const basePlan = { mode: "off" as const, stackedPipeline: [] };
const budget = (over = {}) => ({
  ...DEFAULT_CONTEXT_BUDGET,
  mode: "floor" as const,
  policy: "reserve-output" as const,
  ...over,
});

test("capToInputCeiling lowers a budget that exceeds the known input limit", () => {
  assert.equal(capToInputCeiling(396_000, 272_000), 272_000);
});

test("capToInputCeiling never raises a budget", () => {
  // A wider ceiling than the computed budget must change nothing: the reserve
  // and margin were subtracted for reasons the ceiling knows nothing about.
  assert.equal(capToInputCeiling(100_000, 1_000_000), 100_000);
});

test("capToInputCeiling ignores an absent or unusable ceiling", () => {
  for (const ceiling of [null, undefined, 0, -1, Number.NaN]) {
    assert.equal(
      capToInputCeiling(150_000, ceiling as number | null | undefined),
      150_000,
      `${String(ceiling)} must leave the budget untouched`
    );
  }
});

test("capToInputCeiling caps rather than subtracting the reserve twice", () => {
  // maxInput ALREADY excludes the output reservation. Subtracting the reserve
  // from it again is the #7039 double-count; the result must be exactly the
  // ceiling, not the ceiling minus anything.
  assert.equal(capToInputCeiling(1_000_000, 272_000), 272_000);
});

test("a prompt that fits the total window but not the input ceiling gets compressed", () => {
  // The regression this guards: without the cap, headroom is positive against
  // the inflated target and the adaptive resolver decides no compression is
  // needed — right before upstream rejects the request.
  const estimatedTokens = 300_000;

  const withoutCeiling = resolveAdaptivePlan({
    basePlan,
    estimatedTokens,
    modelContextLimit: 400_000,
    requestMaxTokens: null,
    config: budget(),
  });
  const withCeiling = resolveAdaptivePlan({
    basePlan,
    estimatedTokens,
    modelContextLimit: 400_000,
    modelMaxInputTokens: 272_000,
    requestMaxTokens: null,
    config: budget(),
  });

  assert.ok(
    withoutCeiling.telemetry!.headroomBefore >= 0,
    "fixture must reproduce the inflated target (no compression judged necessary)"
  );
  assert.ok(
    withCeiling.telemetry!.headroomBefore < 0,
    "against the real input ceiling the prompt does NOT fit"
  );
  assert.ok(
    withCeiling.telemetry!.stagesApplied.length > 0,
    "and the resolver must escalate instead of passing it through"
  );
  assert.equal(withCeiling.telemetry!.target, 272_000);
});

test("an absent ceiling leaves the existing budget behaviour byte-identical", () => {
  const args = {
    basePlan,
    estimatedTokens: 300_000,
    modelContextLimit: 400_000,
    requestMaxTokens: null,
    config: budget(),
  };
  assert.deepEqual(
    resolveAdaptivePlan({ ...args, modelMaxInputTokens: null }).telemetry,
    resolveAdaptivePlan(args).telemetry
  );
});
