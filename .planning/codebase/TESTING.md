# Testing Patterns

**Analysis Date:** 2026-08-14

## Test Framework

**Runners:**
- **Node.js native test runner** (`node:test`) - default for ~95% of unit tests
  - Import: `import test from "node:test"` or `import { describe, it, before, after, beforeEach, afterEach, mock } from "node:test"`
  - Assertion: `import assert from "node:assert/strict"`
  - Config: built-in (no config file needed, but respects NODE_OPTIONS)
  
- **Vitest** - for MCP server, autoCombo routing, cache tests, and browser-based tests
  - Config: `vitest.config.ts`
  - Import: `import { describe, it, beforeEach, afterEach, expect, vi } from "vitest"`
  - Environment: jsdom (for React/UI component tests)
  - Execution: `npm run test:vitest` (MCP, autoCombo, cache) and `npm run test:vitest:ui` (UI tests)

- **Playwright** - for end-to-end browser tests
  - Config: `playwright.config.ts`
  - Tests: `tests/e2e/*.spec.ts`
  - Execution: `npm run test:e2e`

**Run Commands:**
```bash
npm run test:unit                  # Run all unit tests (Node.js native)
npm run test:vitest               # Run vitest suite (MCP, autoCombo, cache)
npm run test:vitest:ui            # Run vitest UI tests (React components)
npm run test:integration          # Integration tests (multi-module, DB state)
npm run test:e2e                  # Playwright end-to-end tests
npm run test:coverage             # Coverage gate (60/60/60/60: statements/lines/functions/branches)
npm run test:all                  # All test suites (unit + vitest + vitest:ui + ecosystem + e2e)
npm run test:scoped               # Run tests for changed files only (pre-commit)
npm run test:property             # Property-based tests (fast-check)
npm run test:mutation             # Mutation testing (Stryker)
```

## Test File Organization

**Location:**
- **Primary**: `tests/unit/` directory (most unit tests)
- **Integration**: `tests/integration/` (multi-module tests, combo matrix, live tests)
- **E2E**: `tests/e2e/` (Playwright browser tests)
- **Co-located**: `src/**/__tests__/` or `src/**/__tests__/*.test.ts` (module-specific tests, especially MCP tools)
- **Serial tests**: `tests/unit/serial/` (tests that cannot run in parallel)

**Naming:**
- `*.test.ts` - Node.js test files (native runner)
- `*.test.tsx` - React component tests (vitest)
- `*.test.mjs` - ESM module tests
- `*.spec.ts` - Playwright tests (`tests/e2e/*.spec.ts`)
- `*.live.test.ts` - Live integration tests (require running server)
- `*.property.test.ts` - Property-based tests

## Test Structure

**Node.js native runner pattern:**
```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("feature works correctly", () => {
  const result = calculateSomething();
  assert.equal(result, expectedValue);
});

test("async operation completes", async () => {
  const result = await asyncFunction();
  assert.ok(result);
});
```

**Describe/It pattern:**
```typescript
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

describe("Feature name", () => {
  let fixture: SomeType;

  before(() => {
    // Runs once before all tests in this describe
    setupGlobalState();
  });

  after(() => {
    // Runs once after all tests in this describe
    cleanupGlobalState();
  });

  beforeEach(() => {
    // Runs before each test
    fixture = createFixture();
  });

  afterEach(() => {
    // Runs after each test
    if (fixture) fixture.cleanup();
  });

  it("should do something", () => {
    const result = fixture.doSomething();
    assert.equal(result, expected);
  });

  it("should handle errors", async () => {
    await assert.rejects(() => fixture.failingOperation(), Error);
  });
});
```

**Vitest pattern (for MCP, autoCombo, React):**
```typescript
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

describe("MCP Tool", () => {
  let mockDb: MockDatabase;

  beforeEach(() => {
    mockDb = createMockDb();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should invoke the tool correctly", async () => {
    const result = await toolFunction(mockDb);
    expect(result).toEqual(expectedValue);
    expect(mockDb.query).toHaveBeenCalledWith("SELECT * FROM table");
  });

  it("timeout override for slow tests", async () => {
    // ... slow test code ...
  }, 30000); // 30 second timeout instead of default 5000ms
});
```

## Mocking

**Node.js native test framework:**
```typescript
import { mock } from "node:test";

describe("Mocking with node:test", () => {
  it("mocks database prepare calls", () => {
    const db = getDbInstance();
    const prepareSpy = mock.method(db, "prepare");
    
    callFunctionThatUsesPrepare();
    
    assert.equal(prepareSpy.mock.calls.length, 1);
    const callArgs = prepareSpy.mock.calls[0].arguments;
    prepareSpy.mock.restore();
  });

  it("mocks a function's return value", () => {
    const fn = mock.fn(() => "mocked value");
    const result = fn();
    assert.equal(result, "mocked value");
    assert.equal(fn.mock.calls.length, 1);
  });
});
```

**Vitest mocking:**
```typescript
import { vi } from "vitest";

describe("Mocking with vitest", () => {
  it("mocks functions", () => {
    const mockFn = vi.fn(() => "result");
    expect(mockFn()).toBe("result");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("spies on module methods", () => {
    const module = getModule();
    const spy = vi.spyOn(module, "method");
    
    module.method("arg");
    
    expect(spy).toHaveBeenCalledWith("arg");
    spy.mockRestore();
  });

  it("mocks entire modules", async () => {
    vi.doMock("./module", () => ({
      default: { fn: vi.fn(() => "mocked") },
    }));
    const mod = await import("./module");
    expect(mod.default.fn()).toBe("mocked");
    vi.resetModules();
  });
});
```

**What to Mock:**
- External API calls (HTTP, database backends not in scope)
- File system operations (use temp directories instead where possible)
- Time-dependent functions (use `vi.useFakeTimers()`)
- Complex dependencies when testing units in isolation

**What NOT to Mock:**
- The code under test (never mock what you're testing)
- Built-in modules like `node:fs` (use real temp files or abstraction patterns)
- Database queries when testing database modules (use real SQLite in-memory)
- HTTP client libraries in integration tests (use nock or msw for stubbing)

## Fixtures and Factories

**Test Data:**
```typescript
// tests/unit/fixtures/userFactory.ts
export function createTestUser(overrides?: Partial<User>): User {
  return {
    id: "user-123",
    email: "test@example.com",
    role: "user",
    ...overrides,
  };
}

// In test:
import { createTestUser } from "../fixtures/userFactory";

it("calculates user quota", () => {
  const user = createTestUser({ role: "premium" });
  const quota = calculateQuota(user);
  assert.equal(quota, 10000);
});
```

**Database fixtures:**
```typescript
// tests/_setup/dbFixtures.ts
export async function seedTestDatabase() {
  const db = getDbInstance();
  db.prepare("INSERT INTO providers (id, name) VALUES (?, ?)").run("gpt4", "GPT-4");
  return db;
}

// In test:
before(async () => {
  await seedTestDatabase();
});
```

**Location:**
- `tests/_setup/` - global setup, fixtures, utilities
- `tests/fixtures/` - test data factories
- `src/**/__tests__/fixtures/` - module-specific fixtures (for co-located tests)

## Coverage

**Requirements:** 60/60/60 threshold for statements, lines, functions, and branches
- Enforced via `npm run test:coverage`
- Pre-existing coverage frozen in `quality-baseline.json`
- Ratchet policy: coverage must not regress; update baseline via `npm run quality:ratchet -- --update` when coverage genuinely improves
- Report: HTML report at `coverage/index.html`

**View Coverage:**
```bash
npm run test:coverage               # Run tests with coverage check
npm run coverage:report             # Generate HTML report (after test:coverage)
open coverage/index.html            # View report in browser
```

## Test Types

**Unit Tests:**
- Scope: single function or module in isolation
- Location: `tests/unit/` (primary) or `src/**/__tests__/`
- Mocking: external dependencies
- Examples: `pricing-sync-memoization.test.ts`, `sidebar-icon-accents-3812.test.ts`
- Command: `npm run test:unit`

**Integration Tests:**
- Scope: multiple modules working together, database interactions
- Location: `tests/integration/` or `tests/integration/combo-matrix/`
- Database: real SQLite (in isolated temp directory per test)
- Examples: combo routing matrix tests, heap growth tests
- Command: `npm run test:integration`

**E2E Tests:**
- Scope: complete user workflows through browser or HTTP client
- Location: `tests/e2e/`
- Framework: Playwright
- Examples: login flow, dashboard navigation, API responses
- Command: `npm run test:e2e`

**Live Tests:**
- Scope: behavior with real upstream providers or servers
- Location: `tests/integration/combo-live/*.live.test.ts` or `tests/boundary/*.live.test.ts`
- Command: `npm run test:combo:live` (requires RUN_COMBO_LIVE=1)
- Execution: manual, on-demand, or CI with real credentials

## Common Patterns

**Async Testing:**
```typescript
// Node.js native — promise rejection
it("rejects on error", async () => {
  await assert.rejects(
    () => asyncFunction(),
    (err: Error) => err.message.includes("expected text")
  );
});

// Vitest — expect.rejects
it("throws on bad input", async () => {
  await expect(() => asyncFunction("bad")).rejects.toThrow("expected");
});

// With timeout for slow operations
it("handles slow network", async () => {
  const result = await slowNetworkCall();
  assert.ok(result);
}, 10000); // 10 second timeout
```

**Error Testing:**
```typescript
// Node.js native
it("validates input", () => {
  assert.throws(
    () => validateSchema(invalidData),
    { message: /required field/ }
  );
});

// Vitest
it("rejects invalid schema", () => {
  expect(() => validateSchema(invalidData)).toThrow(/required field/);
});
```

**Database Testing:**
```typescript
import { getDbInstance } from "@/lib/db/core";

it("inserts and retrieves data", () => {
  const db = getDbInstance();
  
  // Insert
  const result = db.prepare("INSERT INTO models (id, name) VALUES (?, ?)").run("m1", "Model 1");
  
  // Retrieve
  const model = db.prepare("SELECT * FROM models WHERE id = ?").get("m1");
  assert.equal(model.name, "Model 1");
});
```

**Memoization/Cache Testing:**
```typescript
it("returns same reference for repeated reads within cache version", () => {
  const first = getCachedValue();
  const second = getCachedValue();
  assert.equal(second, first); // Same object reference, not just deep equality
});

it("invalidates cache after write", () => {
  const before = getCachedValue();
  writeValue(newData);
  const after = getCachedValue();
  assert.notEqual(after, before); // Different reference = cache invalidated
});
```

**Mock Database Pattern:**
```typescript
import { mock } from "node:test";

it("tracks database calls", () => {
  const db = getDbInstance();
  const prepareSpy = mock.method(db, "prepare");
  const callsBefore = prepareSpy.mock.calls.length;

  // Code under test
  doSomethingWithDb();

  const callsAfter = prepareSpy.mock.calls.length;
  prepareSpy.mock.restore();
  
  assert.ok(callsAfter - callsBefore <= 1, "should only query once (memoized)");
});
```

**Setup/Teardown with Cleanup:**
```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

it("works with temporary files", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
  
  try {
    const filePath = path.join(tempDir, "test.txt");
    fs.writeFileSync(filePath, "content");
    
    const content = fs.readFileSync(filePath, "utf8");
    assert.equal(content, "content");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

## Database Handle Cleanup (Critical for Node.js test runner)

**IMPORTANT:** Any test that triggers database migrations or establishes SQLite connections MUST call `resetDbInstance()` in a test.after() hook.

```typescript
import test from "node:test";
import { getDbInstance, resetDbInstance } from "@/lib/db/core";

test.describe("Database operations", () => {
  test.afterEach(async () => {
    try {
      resetDbInstance(); // Close handle; prevents indefinite hang
    } catch {
      // ignore cleanup errors
    }
  });

  test("initializes database", () => {
    const db = getDbInstance();
    // ... test code ...
  });
});
```

Failure to release handles causes Node's native test runner to hang indefinitely.

---

*Testing analysis: 2026-08-14*
