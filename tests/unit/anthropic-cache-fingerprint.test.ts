import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLAUDE_CODE_CLIENT_BILLING_VERSION,
  CLAUDE_CODE_CLIENT_BUILD_REVISION,
  CLAUDE_CODE_CLIENT_VERSION,
} from "../../src/shared/constants/claudeCodeClient.ts";
import { CLAUDE_CLI_BILLING_VERSION } from "../../open-sse/config/anthropicHeaders.ts";
import {
  buildBillingHeaderValue,
  DEFAULT_CC_BRIDGE_PIPELINE,
} from "../../open-sse/services/ccBridgeTransforms.ts";

describe("Anthropic billing header fingerprint (#1638)", () => {
  it("uses the immutable build revision captured from the signed CLI", () => {
    assert.equal(
      CLAUDE_CODE_CLIENT_BILLING_VERSION,
      `${CLAUDE_CODE_CLIENT_VERSION}.${CLAUDE_CODE_CLIENT_BUILD_REVISION}`
    );
    assert.equal(CLAUDE_CODE_CLIENT_VERSION, "2.1.219");
    assert.equal(CLAUDE_CODE_CLIENT_BUILD_REVISION, "250");
    assert.equal(CLAUDE_CODE_CLIENT_BILLING_VERSION, "2.1.219.250");
    assert.equal(CLAUDE_CLI_BILLING_VERSION, CLAUDE_CODE_CLIENT_BILLING_VERSION);
  });

  it("keeps the captured billing prefix stable across prompt content", () => {
    const billingOp = DEFAULT_CC_BRIDGE_PIPELINE.find(
      (operation) => operation.kind === "inject_billing_header"
    );
    assert.ok(billingOp && billingOp.kind === "inject_billing_header");

    const options = {
      entrypoint: billingOp.entrypoint,
      versionFormat: billingOp.versionFormat,
      cchAlgo: "static-zero" as const,
      buildRevision: billingOp.buildRevision,
    };
    const first = buildBillingHeaderValue([{ role: "user", content: "first prompt" }], options);
    const second = buildBillingHeaderValue([{ role: "user", content: "second prompt" }], options);

    assert.equal(first, second);
    assert.equal(
      first,
      "x-anthropic-billing-header: cc_version=2.1.219.250; cc_entrypoint=sdk-cli; cch=00000;"
    );
  });
});
