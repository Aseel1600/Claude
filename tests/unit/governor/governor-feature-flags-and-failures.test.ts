import test from "node:test";
import assert from "node:assert/strict";

import { GovernorManager } from "../../../open-sse/governor/governorManager.ts";
import {
  isGovernorTelemetryEnabled,
  getGovernorMode,
} from "../../../src/shared/utils/featureFlags.ts";
import {
  getFeatureFlagOverride,
  removeFeatureFlagOverride,
  setFeatureFlagOverride,
} from "../../../src/lib/db/featureFlags.ts";

function withEnvironment(key: string, value: string | undefined, fn: () => void): void {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test("Governor mode accepts only off and shadow, defaulting garbage to off", () => {
  const previousOverride = getFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  try {
    withEnvironment("INTELLIGENCE_GOVERNOR_MODE", undefined, () =>
      assert.equal(getGovernorMode(), "off")
    );
    withEnvironment("INTELLIGENCE_GOVERNOR_MODE", "off", () =>
      assert.equal(getGovernorMode(), "off")
    );
    withEnvironment("INTELLIGENCE_GOVERNOR_MODE", "shadow", () =>
      assert.equal(getGovernorMode(), "shadow")
    );
    withEnvironment("INTELLIGENCE_GOVERNOR_MODE", "garbage", () =>
      assert.equal(getGovernorMode(), "off")
    );
  } finally {
    if (previousOverride === undefined) removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
    else setFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE", previousOverride);
  }
});

test("Governor decide() failures are isolated from the request result", () => {
  const previousOverride = getFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  const previousGovernor = GovernorManager.getGovernor();
  GovernorManager.setGovernor({
    name: "throwing-test-governor",
    version: "test",
    decide() {
      throw new Error("synthetic governor failure");
    },
  });
  try {
    withEnvironment("INTELLIGENCE_GOVERNOR_MODE", "shadow", () => {
      const result = GovernorManager.evaluateShadow(
        { correlationId: "throwing-governor", taskKind: "unknown" },
        { provider: "openai", model: "gpt-test" }
      );
      assert.equal(result.mode, "shadow");
      assert.equal(result.recommendation, null);
    });
  } finally {
    GovernorManager.setGovernor(previousGovernor);
    if (previousOverride === undefined) removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
    else setFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE", previousOverride);
  }
});

test("telemetry flag disables telemetry without disabling shadow evaluation", () => {
  const previousMode = getFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  const previousTelemetry = getFeatureFlagOverride("INTELLIGENCE_GOVERNOR_TELEMETRY");
  removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_TELEMETRY");
  try {
    withEnvironment("INTELLIGENCE_GOVERNOR_MODE", "shadow", () => {
      withEnvironment("INTELLIGENCE_GOVERNOR_TELEMETRY", "false", () => {
        assert.equal(isGovernorTelemetryEnabled(), false);
        const result = GovernorManager.evaluateShadow(
          { correlationId: "telemetry-disabled", taskKind: "trivial_control" },
          { provider: "openai", model: "gpt-test" }
        );
        assert.equal(result.mode, "shadow");
        assert.notEqual(result.recommendation, null);
      });
    });
  } finally {
    if (previousMode === undefined) removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
    else setFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE", previousMode);
    if (previousTelemetry === undefined)
      removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_TELEMETRY");
    else setFeatureFlagOverride("INTELLIGENCE_GOVERNOR_TELEMETRY", previousTelemetry);
  }
});
