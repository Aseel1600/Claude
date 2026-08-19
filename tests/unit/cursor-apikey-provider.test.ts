/**
 * Cursor accepts a pasted `crsr_…` API key next to its OAuth/IDE-session
 * connections (dual-auth, same layout as clinepass / codebuddy-cn): the
 * managed-connection gate admits it, the dashboard card counts it, the
 * registry stays OAuth-primary (resilience profile unchanged) and the
 * executor swaps the key for the exchanged session token before dialing.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const { supportsDualAuthProvider, supportsApiKeyOnFreeProvider } =
  await import("../../src/shared/constants/providers.ts");
const { isManagedProviderConnectionId } = await import("../../src/lib/providers/catalog.ts");
const { connectionMatchesProviderCard } =
  await import("../../src/app/(dashboard)/dashboard/providers/providerPageUtils.ts");
const { OAUTH_PROVIDERS, APIKEY_PROVIDERS } =
  await import("../../src/shared/constants/providers.ts");
const { cursorProvider } = await import("../../open-sse/config/providers/registry/cursor/index.ts");
const { getProviderCategory } = await import("../../open-sse/config/providerRegistry.ts");
const { CursorExecutor } = await import("../../open-sse/executors/cursor.ts");
const { __resetCursorApiKeyAuthForTest } =
  await import("../../open-sse/services/cursorApiKeyAuth.ts");

const API_KEY = "crsr_provider_test_key";

function jwt(exp: number): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ exp })}.sig`;
}

describe("cursor dual-auth wiring", () => {
  it("admits API-key connections through the managed gate while staying OAuth-primary", () => {
    assert.equal(isManagedProviderConnectionId("cursor"), true);
    assert.equal(supportsDualAuthProvider("cursor"), true);
    assert.equal(supportsApiKeyOnFreeProvider("cursor"), false);
    for (const authType of ["oauth", "apikey", "api_key"]) {
      assert.equal(
        connectionMatchesProviderCard({ provider: "cursor", authType }, "cursor", "oauth"),
        true,
        authType
      );
    }
  });

  it("keeps one OAuth catalog card and the OAuth resilience profile", () => {
    assert.ok(OAUTH_PROVIDERS.cursor);
    assert.ok(!APIKEY_PROVIDERS.cursor);
    assert.equal(cursorProvider.authType, "oauth");
    assert.equal(getProviderCategory("cursor"), "oauth");
  });
});

describe("CursorExecutor credential resolution", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetCursorApiKeyAuthForTest();
  });

  it("sends the stripped IDE session token for OAuth connections", () => {
    const executor = new CursorExecutor();
    const headers = executor.buildHeaders({
      accessToken: "user_01::ide.session.jwt",
      providerSpecificData: {},
    });
    assert.equal(headers.authorization, "Bearer ide.session.jwt");
    assert.equal(headers["x-cursor-client-type"], "cli");
  });

  it("exchanges a crsr_ key and sends the session JWT, never the raw key", async () => {
    const calls: string[] = [];
    const exp = Math.floor(Date.now() / 1000) + 3600;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ accessToken: jwt(exp), refreshToken: jwt(exp) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const executor = new CursorExecutor();
    const resolved = await executor.resolveExecutionCredentials({
      apiKey: API_KEY,
      providerSpecificData: {},
    });
    assert.ok(!(resolved instanceof Response));
    const headers = executor.buildHeaders(resolved);
    assert.equal(headers.authorization, `Bearer ${jwt(exp)}`);
    assert.ok(!headers.authorization.includes(API_KEY));
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/auth\/exchange_user_api_key$/);
  });

  it("returns a sanitized 401 response when Cursor rejects the key", async () => {
    globalThis.fetch = (async () => new Response("bad key", { status: 401 })) as typeof fetch;
    const executor = new CursorExecutor();
    const resolved = await executor.resolveExecutionCredentials({ apiKey: API_KEY });
    assert.ok(resolved instanceof Response);
    assert.equal(resolved.status, 401);
    const body = (await resolved.json()) as { error: { message: string; type: string } };
    assert.equal(body.error.type, "authentication_error");
    assert.ok(!body.error.message.includes(API_KEY));
    assert.ok(!body.error.message.includes("at /"));
  });

  it("leaves OAuth credentials untouched without calling the exchange endpoint", async () => {
    globalThis.fetch = (async () => {
      throw new Error("exchange must not be called");
    }) as typeof fetch;
    const executor = new CursorExecutor();
    const credentials = { accessToken: "user_01::ide.session.jwt" };
    const resolved = await executor.resolveExecutionCredentials(credentials);
    assert.equal(resolved, credentials);
  });
});
