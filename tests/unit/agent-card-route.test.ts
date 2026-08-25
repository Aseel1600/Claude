/**
 * Unit tests for GET /.well-known/agent.json (Agent Card endpoint).
 *
 * Verifies:
 *  - Response includes 6 skills after the list-capabilities addition
 *  - list-capabilities entry has the required id, tags, and examples
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

const { GET } = await import("../../src/app/.well-known/agent.json/route.js");

/**
 * Build a minimal NextRequest stand-in for the Agent Card handler.
 * The route derives its base URL via getBaseUrl(request), which reads
 * request.nextUrl.origin, so the mock only needs a nextUrl URL object.
 */
function makeRequest(url = "http://localhost:20128/.well-known/agent.json"): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

interface AgentSkillEntry {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
}

interface AgentCard {
  name: string;
  version: string;
  skills: AgentSkillEntry[];
}

test("GET /.well-known/agent.json returns 6 skills", async () => {
  const response = await GET(makeRequest());
  assert.equal(response.status, 200, "Expected HTTP 200");

  const body = (await response.json()) as AgentCard;
  assert.ok(Array.isArray(body.skills), "skills is an array");
  assert.equal(body.skills.length, 6, "Expected exactly 6 skills");
});

test("Agent Card includes list-capabilities skill entry", async () => {
  const response = await GET(makeRequest());
  const body = (await response.json()) as AgentCard;

  const skill = body.skills.find((s) => s.id === "list-capabilities");
  assert.ok(skill, "list-capabilities skill must be present in Agent Card");
});

test("list-capabilities entry has required tags [discovery, capabilities]", async () => {
  const response = await GET(makeRequest());
  const body = (await response.json()) as AgentCard;

  const skill = body.skills.find((s) => s.id === "list-capabilities");
  assert.ok(skill, "list-capabilities skill must be present");
  assert.ok(Array.isArray(skill.tags), "tags is an array");
  assert.ok(skill.tags.includes("discovery"), "tags includes 'discovery'");
  assert.ok(skill.tags.includes("capabilities"), "tags includes 'capabilities'");
});

test("list-capabilities entry has at least one example question", async () => {
  const response = await GET(makeRequest());
  const body = (await response.json()) as AgentCard;

  const skill = body.skills.find((s) => s.id === "list-capabilities");
  assert.ok(skill, "list-capabilities skill must be present");
  assert.ok(Array.isArray(skill.examples), "examples is an array");
  assert.ok(skill.examples.length > 0, "examples has at least one entry");
});

test("Agent Card includes all 5 original skills", async () => {
  const response = await GET(makeRequest());
  const body = (await response.json()) as AgentCard;

  const originalIds = [
    "smart-routing",
    "quota-management",
    "provider-discovery",
    "cost-analysis",
    "health-report",
  ];

  for (const id of originalIds) {
    assert.ok(
      body.skills.some((s) => s.id === id),
      `Original skill '${id}' must be present in Agent Card`
    );
  }
});
