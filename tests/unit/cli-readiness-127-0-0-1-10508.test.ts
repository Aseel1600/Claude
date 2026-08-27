import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { resolve, join } from "node:path";

import { LOOPBACK_PROBE_HOSTS } from "../../bin/cli/utils/pid.mjs";

// Regression guard for #10508: pollHealthOnce() used "localhost" (forcing DNS
// resolution). A slow "localhost" DNS lookup (Windows VPN split-DNS/search-
// suffix probing, corporate resolvers, DNS-filtering security software) can
// exceed the 2s per-poll timeout and make waitForServer() report "hanging"
// forever even though the server is healthy. The dual-loopback probe is driven
// by an exported host set, so asserting every entry is an IP literal is stronger
// than matching one fetch expression in the source text.

const filePath = resolve(join(process.cwd(), "bin/cli/utils/pid.mjs"));
const source = readFileSync(filePath, "utf-8");

test("issue #10508: readiness probes use only the two literal loopback addresses", () => {
  for (const host of LOOPBACK_PROBE_HOSTS) {
    assert.notEqual(net.isIP(host), 0, `readiness probe host must be an IP literal: ${host}`);
  }
  assert.deepEqual(
    new Set(LOOPBACK_PROBE_HOSTS),
    new Set(["127.0.0.1", "::1"]),
    "readiness probe host set must contain exactly the IPv4 and IPv6 loopbacks"
  );
  assert.doesNotMatch(source, /http:\/\/localhost:/, "readiness probe must not use localhost");
});
