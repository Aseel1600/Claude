import test from "node:test";
import assert from "node:assert/strict";

import {
  getCustomQuotaProviderKind,
  getCustomQuotaProviderLabel,
  supportsCustomQuotaConnection,
} from "../../src/shared/utils/customQuotaProviders";
import { isSupportedUsageConnection } from "../../src/lib/usage/providerLimits";

test("recognizes The Claw Bay compatible provider by baseUrl", () => {
  const connection = {
    id: "conn-tcb",
    provider: "openai-compatible-chat-123",
    authType: "apikey",
    providerSpecificData: { baseUrl: "https://api.theclawbay.com/v1", nodeName: "[ TCB ]" },
  };

  assert.equal(
    getCustomQuotaProviderKind(connection.provider, connection.providerSpecificData),
    "theclawbay"
  );
  assert.equal(
    getCustomQuotaProviderLabel(connection.provider, connection.providerSpecificData),
    "The Claw Bay"
  );
  assert.equal(supportsCustomQuotaConnection(connection), true);
  assert.equal(isSupportedUsageConnection(connection), true);
});

test("recognizes Verboo compatible provider by baseUrl", () => {
  const connection = {
    id: "conn-verboo",
    provider: "openai-compatible-chat-456",
    authType: "apikey",
    providerSpecificData: { baseUrl: "https://code.verboo.ai/router/v1", nodeName: "Verboo" },
  };

  assert.equal(
    getCustomQuotaProviderKind(connection.provider, connection.providerSpecificData),
    "verboo"
  );
  assert.equal(
    getCustomQuotaProviderLabel(connection.provider, connection.providerSpecificData),
    "Verboo"
  );
  assert.equal(supportsCustomQuotaConnection(connection), true);
  assert.equal(isSupportedUsageConnection(connection), true);
});

test("ignores unrelated compatible providers", () => {
  const connection = {
    id: "conn-other",
    provider: "openai-compatible-chat-789",
    authType: "apikey",
    providerSpecificData: { baseUrl: "https://example.com/v1" },
  };

  assert.equal(
    getCustomQuotaProviderKind(connection.provider, connection.providerSpecificData),
    null
  );
  assert.equal(supportsCustomQuotaConnection(connection), false);
  assert.equal(isSupportedUsageConnection(connection), false);
});
