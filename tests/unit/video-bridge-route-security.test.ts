import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LOCAL_ONLY_API_PREFIXES, isLocalOnlyPath } from "../../src/server/authz/routeGuard.ts";
import { SPAWN_CAPABLE_PREFIXES } from "../../src/shared/constants/spawnCapablePrefixes.ts";
import { managementPolicy } from "../../src/server/authz/policies/management.ts";
import {
  POST,
  readBoundedVideoBrokerBody,
} from "../../src/app/api/modality-bridge/video/extract/route.ts";
import { buildVideoBridgeBrokerHeaders } from "../../src/lib/guardrails/videoBridgeBrokerAuth.ts";
import { AUTHZ_HEADER_PEER_LOCALITY } from "../../src/server/authz/headers.ts";

const PREFIX = "/api/modality-bridge/video/";
const EXTRACT_PATH = `${PREFIX}extract`;

test("Video Bridge runtime and broker share an exact LOCAL_ONLY + SPAWN_CAPABLE prefix", () => {
  assert.ok(LOCAL_ONLY_API_PREFIXES.includes(PREFIX));
  assert.ok(SPAWN_CAPABLE_PREFIXES.includes(PREFIX));
  assert.equal(isLocalOnlyPath(EXTRACT_PATH, "POST"), true);
  assert.equal(isLocalOnlyPath(`${PREFIX}runtime`, "GET"), true);
});

test("non-loopback broker access is rejected as LOCAL_ONLY before authentication", async () => {
  const outcome = await managementPolicy.evaluate({
    request: {
      method: "POST",
      headers: new Headers({ authorization: "Bearer stolen-token" }),
      url: `https://dashboard.example${EXTRACT_PATH}`,
      nextUrl: { pathname: EXTRACT_PATH },
    },
    classification: {
      routeClass: "MANAGEMENT",
      normalizedPath: EXTRACT_PATH,
      reason: "management_api",
    },
    requestId: "req_video_bridge_remote",
  } as unknown as Parameters<typeof managementPolicy.evaluate>[0]);

  assert.equal(outcome.allow, false);
  if (!outcome.allow) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, "LOCAL_ONLY");
  }
});

test("extract handler rejects direct calls without the loopback broker identity before reading media", async () => {
  const response = await POST(
    new Request(`http://localhost${EXTRACT_PATH}?frames=1`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("video"),
    })
  );
  assert.equal(response.status, 403);
  assert.equal(JSON.stringify(await response.json()).includes("token"), false);
});

test("bounded broker body reading accepts absent length and cancels a lying oversized stream", async () => {
  const bodyWithoutLength = new Request(`http://localhost${EXTRACT_PATH}`, {
    method: "POST",
    body: Buffer.from("safe"),
  });
  assert.deepEqual(await readBoundedVideoBrokerBody(bodyWithoutLength, 4), Buffer.from("safe"));

  let cancelled = false;
  const maliciousBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("1234"));
      controller.enqueue(Buffer.from("5"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const lying = new Request(`http://localhost${EXTRACT_PATH}`, {
    method: "POST",
    headers: { "Content-Length": "1" },
    body: maliciousBody,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(() => readBoundedVideoBrokerBody(lying, 4), /VIDEO_INPUT_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test("configured base path preserves the exact self-hop without widening broker authentication", async () => {
  const previousBasePath = process.env.OMNIROUTE_BASE_PATH;
  process.env.OMNIROUTE_BASE_PATH = "/omniroute";
  try {
    const headers = new Headers({
      ...buildVideoBridgeBrokerHeaders(),
      [AUTHZ_HEADER_PEER_LOCALITY]: "loopback",
      "Content-Type": "text/plain",
    });
    const response = await POST(
      new Request(`http://localhost/omniroute${EXTRACT_PATH}?frames=1`, {
        method: "POST",
        headers,
        body: "video",
      })
    );
    assert.equal(response.status, 400, "the exact base-path route must pass path and broker auth");

    const adjacent = await POST(
      new Request(`http://localhost/omniroute${PREFIX}runtime?frames=1`, {
        method: "POST",
        headers,
        body: "video",
      })
    );
    assert.equal(adjacent.status, 404);

    const policyOutcome = await managementPolicy.evaluate({
      request: {
        method: "POST",
        headers,
        ip: "127.0.0.1",
        url: `http://localhost/omniroute${EXTRACT_PATH}`,
        nextUrl: { pathname: `/omniroute${EXTRACT_PATH}` },
      },
      classification: {
        routeClass: "MANAGEMENT",
        normalizedPath: EXTRACT_PATH,
        reason: "management_api",
      },
      requestId: "req_video_bridge_base_path",
    } as unknown as Parameters<typeof managementPolicy.evaluate>[0]);
    assert.equal(policyOutcome.allow, true);
  } finally {
    if (previousBasePath === undefined) delete process.env.OMNIROUTE_BASE_PATH;
    else process.env.OMNIROUTE_BASE_PATH = previousBasePath;
  }
});

test("OpenAPI marks both Video Bridge process routes loopback-only", () => {
  const openapi = readFileSync("docs/openapi.yaml", "utf8");
  for (const path of [`${PREFIX}runtime`, EXTRACT_PATH]) {
    const start = openapi.indexOf(`  ${path}:`);
    assert.notEqual(start, -1, `${path} missing from OpenAPI`);
    assert.match(openapi.slice(start, start + 800), /x-loopback-only:\s*true/);
  }
});
