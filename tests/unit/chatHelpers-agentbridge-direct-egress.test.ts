import test from "node:test";
import assert from "node:assert/strict";
import { isAgentBridgeInternalRequest } from "../../src/sse/handlers/chatRequestMetadata.ts";

test("AgentBridge requests are classified by the internal source header", () => {
  assert.equal(
    isAgentBridgeInternalRequest(new Headers({ "x-omniroute-source": "agent-bridge" })),
    true
  );
  assert.equal(
    isAgentBridgeInternalRequest(new Headers({ "x-omniroute-source": "inspector-replay" })),
    false
  );
  assert.equal(isAgentBridgeInternalRequest(null), false);
});
