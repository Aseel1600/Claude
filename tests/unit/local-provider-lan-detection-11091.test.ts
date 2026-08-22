import test from "node:test";
import assert from "node:assert/strict";

import { isLocalProvider } from "../../open-sse/config/providerRegistry.ts";

// #11091 — isLocalProvider() gates the 404 model-only lockout in
// src/sse/services/auth.ts. It used to match only localhost / 127.0.0.1 /
// 172.16.0.0/12, so a self-hosted backend on a normal LAN was classified as
// remote and one missing model cooled the entire connection.

test("classifies RFC1918 LAN hosts as local", () => {
  for (const host of [
    "http://192.168.1.50:11434/v1",
    "http://192.168.0.15:11434/v1",
    "http://10.10.0.181:11434/v1",
    "http://10.0.0.1:1234/v1",
    "http://172.16.0.1:11434/v1",
    "http://172.31.255.254:11434/v1",
  ]) {
    assert.equal(isLocalProvider(host), true, `expected local: ${host}`);
  }
});

test("classifies CGNAT/Tailscale and link-local hosts as local", () => {
  assert.equal(isLocalProvider("http://100.64.0.1:11434/v1"), true);
  assert.equal(isLocalProvider("http://100.127.255.254:11434/v1"), true);
  assert.equal(isLocalProvider("http://169.254.1.1:11434/v1"), true);
});

test("classifies mDNS and reserved private suffixes as local", () => {
  assert.equal(isLocalProvider("http://studio.local:11434/v1"), true);
  assert.equal(isLocalProvider("http://box.internal:11434/v1"), true);
  assert.equal(isLocalProvider("http://dev.localhost:11434/v1"), true);
});

test("keeps the previously supported loopback forms local", () => {
  assert.equal(isLocalProvider("http://localhost:11434/v1"), true);
  assert.equal(isLocalProvider("http://127.0.0.1:11434/v1"), true);
  assert.equal(isLocalProvider("http://[::1]:11434/v1"), true);
});

test("classifies IPv6 unique-local and link-local hosts as local", () => {
  assert.equal(isLocalProvider("http://[fd00::1]:11434/v1"), true);
  assert.equal(isLocalProvider("http://[fe80::1]:11434/v1"), true);
});

test("does NOT classify public hosts as local", () => {
  for (const host of [
    "https://api.openai.com/v1",
    "https://generativelanguage.googleapis.com/v1beta",
    "http://8.8.8.8:11434/v1",
    "http://172.15.0.1:11434/v1", // just below the 172.16/12 range
    "http://172.32.0.1:11434/v1", // just above the 172.16/12 range
    "http://100.63.255.255:11434/v1", // just below the 100.64/10 range
    "http://192.169.1.1:11434/v1", // just outside 192.168/16
  ]) {
    assert.equal(isLocalProvider(host), false, `expected non-local: ${host}`);
  }
});

test("fails open on missing or unparseable input", () => {
  // isPrivateHost() fails CLOSED (empty host => private) because it guards
  // egress. isLocalProvider() must fail OPEN — it only widens a lockout scope.
  assert.equal(isLocalProvider(null), false);
  assert.equal(isLocalProvider(undefined), false);
  assert.equal(isLocalProvider(""), false);
  assert.equal(isLocalProvider("not a url"), false);
  assert.equal(isLocalProvider("file:///models"), false);
});
