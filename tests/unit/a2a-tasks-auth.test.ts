import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TASKS_ROUTE = path.resolve(__dirname, "../../src/app/api/a2a/tasks/route.ts");
const A2A_ROUTE = path.resolve(__dirname, "../../src/app/a2a/route.ts");

const source = fs.readFileSync(TASKS_ROUTE, "utf-8");

function hasImport(src: string, name: string, from: string): boolean {
  const pattern = new RegExp(
    `import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+["']${from}["']`
  );
  return pattern.test(src);
}

function extractFunction(src: string, name: string): string {
  const start = src.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`));
  if (start === -1) throw new Error(`function ${name} not found`);
  let brace = 0;
  let inString: string | null = null;
  let i = start;
  let foundOpen = false;
  while (i < src.length) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inString) {
      if (ch === inString && prev !== "\\") inString = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{") {
      foundOpen = true;
      brace++;
    } else if (ch === "}") {
      brace--;
      if (foundOpen && brace === 0) {
        return src.slice(start, i + 1);
      }
    }
    i++;
  }
  throw new Error(`could not extract function ${name}`);
}

function stripFunctionTypes(fnSource: string): string {
  return fnSource.replace(
    /\bfunction\s+(\w+)\s*\(([^)]*)\)\s*:\s*\w+\s*\{/,
    (_match, name, params) => {
      const stripped = params.replace(/\b(\w+)\s*:\s*[^,]+/g, "$1");
      return `function ${name}(${stripped}) {`;
    }
  );
}

test("tasks route uses the same constant-time contract as src/app/a2a/route.ts", () => {
  const a2aSource = fs.readFileSync(A2A_ROUTE, "utf-8");
  assert.ok(
    hasImport(a2aSource, "timingSafeEqual", "node:crypto"),
    "reference route imports timingSafeEqual"
  );

  assert.ok(
    hasImport(source, "timingSafeEqual", "node:crypto"),
    "tasks route imports timingSafeEqual"
  );
  assert.ok(
    /\btokensMatch\s*\(\s*token\s*,\s*configuredKey\s*\)/.test(source),
    "tasks route authenticates with tokensMatch(token, configuredKey)"
  );
  assert.ok(
    !/return\s+token\s*===\s*configuredKey\s*;/.test(source),
    "tasks route no longer uses a plain === bearer compare"
  );
});

test("tokensMatch behaves like the helper in src/app/a2a/route.ts", () => {
  const fnSource = stripFunctionTypes(extractFunction(source, "tokensMatch"));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const tokensMatch = new Function("timingSafeEqual", "Buffer", `return ${fnSource}`)(
    crypto.timingSafeEqual,
    Buffer
  ) as (provided: string, expected: string) => boolean;

  assert.equal(tokensMatch("omniroute-a2a-test-key", "omniroute-a2a-test-key"), true);
  assert.equal(
    tokensMatch("x".repeat("omniroute-a2a-test-key".length), "omniroute-a2a-test-key"),
    false,
    "same-length different token is rejected"
  );
  assert.equal(tokensMatch("", "omniroute-a2a-test-key"), false, "empty token is rejected");
  assert.equal(
    tokensMatch("short", "omniroute-a2a-test-key"),
    false,
    "different-length token is rejected without throwing"
  );
});

test("authenticateA2A preserves the documented semantics", () => {
  const tokensMatchSource = stripFunctionTypes(extractFunction(source, "tokensMatch"));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const tokensMatch = new Function("timingSafeEqual", "Buffer", `return ${tokensMatchSource}`)(
    crypto.timingSafeEqual,
    Buffer
  ) as (provided: string, expected: string) => boolean;

  const authSource = stripFunctionTypes(extractFunction(source, "authenticateA2A"));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const authenticateA2A = new Function("tokensMatch", `return ${authSource}`)(
    tokensMatch
  ) as (request: { headers: { get(name: string): string | null } }) => boolean;

  const API_KEY = "omniroute-a2a-test-key";

  function makeRequest(token?: string) {
    return {
      headers: {
        get(name: string) {
          if (name.toLowerCase() !== "authorization") return null;
          return token === undefined ? null : `Bearer ${token}`;
        },
      },
    };
  }

  delete process.env.OMNIROUTE_API_KEY;
  assert.equal(
    authenticateA2A(makeRequest()),
    true,
    "when OMNIROUTE_API_KEY is not set the route is open"
  );

  process.env.OMNIROUTE_API_KEY = API_KEY;
  assert.equal(authenticateA2A(makeRequest(API_KEY)), true, "a valid bearer token passes auth");
  assert.equal(
    authenticateA2A(makeRequest("x".repeat(API_KEY.length))),
    false,
    "a same-length but different token is rejected"
  );
  assert.equal(authenticateA2A(makeRequest("")), false, "an empty bearer token is rejected");

  delete process.env.OMNIROUTE_API_KEY;
});
