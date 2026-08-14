# Coding Conventions

**Analysis Date:** 2026-08-14

## Naming Patterns

**Files:**
- Utilities and non-component modules: camelCase (e.g., `numeric.ts`, `logger.ts`, `errorConfig.ts`)
- Kebab-case used for some path segments (e.g., `provider-models`, `api-manager`)
- API routes: `route.ts` by convention in Next.js app directory
- Test files: `*.test.ts`, `*.test.tsx`, or `*.test.mjs`

**Functions:**
- camelCase for all functions (e.g., `sanitizeErrorMessage`, `normalizeRequestedModelIds`, `toNumber`, `createLogger`)
- Public API functions are exported as named exports
- Helper/utility functions use clear, descriptive names

**Variables:**
- camelCase for all variable names (e.g., `firstLine`, `singleModelId`, `transportConfig`)
- Constants: UPPER_SNAKE (e.g., `MAX_ERROR_LEN`, `SOURCE_EXT`, `BLOCKED_KEYS`, `SIDEBAR_ICON_ACCENTS`)
- Boolean variables/functions start with `is` or `has` (e.g., `isPosix`, `isWindows`, `isAuthenticated`)

**Types:**
- PascalCase for TypeScript types and interfaces (e.g., `ErrorResponseBody`, `LoggerOptions`, `ModelCompatPatch`)
- Generic type parameters: single uppercase letter or descriptive PascalCase (e.g., `T`, `TRecord`)
- Enum values: UPPER_SNAKE

**Components:**
- React components: PascalCase function names (e.g., `InitPage`, `ApiManagerPageClient`, `EndpointPageClient`)
- Custom hooks: camelCase prefixed with `use` (e.g., `useLocalStorage`, `useIsAuth`)

## Code Style

**Formatting:**
- Tool: Prettier (enforced via lint-staged on pre-commit)
- Indent: 2 spaces
- Semicolons: true (required)
- Quotes: double quotes (e.g., `"use strict"`, not `'use strict'`)
- Print width: 100 characters
- Trailing commas: es5 (trailing commas in arrays/objects, but not in function parameters)

**Linting:**
- Tool: ESLint with flat config (`eslint.config.mjs`)
- Zero-warning policy: all new violations are errors
- Pre-existing violations frozen in `config/quality/eslint-suppressions.json` (ESLint native bulk suppressions)
- Critical rules (always error):
  - `no-eval`: forbidden everywhere (never use `eval()`)
  - `no-implied-eval`: forbidden everywhere (never use `setTimeout("code")` style)
  - `no-new-func`: forbidden everywhere (never use `new Function()`)
  - `no-explicit-any`: error in `open-sse/` and `tests/` (incremental adoption)
  - `import/no-anonymous-default-export`: error in `src/`
  - `react-hooks/exhaustive-deps`: error in React code
  - `@next/next/no-img-element`: error (use `Image` component)
- Import boundary restrictions: no direct imports of executor implementations or localDb barrel

## Import Organization

**Order:**
1. External packages (e.g., `import axios from "axios"`, `import pino from "pino"`)
2. Node.js built-ins (e.g., `import fs from "node:fs"`, `import path from "node:path"`)
3. Internal `@/` imports from src (e.g., `import { logger } from "@/shared/utils/logger"`)
4. `@omniroute/open-sse` imports (monorepo workspace)
5. Relative imports (e.g., `import { util } from "../utils"`)

**Path Aliases:**
- `@/*` → `src/` (primary alias for source files)
- `@omniroute/open-sse` → `open-sse/` (workspace root)
- `@omniroute/open-sse/*` → `open-sse/*` (internal workspace imports)

**Database imports:**
- Prefer importing from domain modules under `src/lib/db/` (e.g., `src/lib/db/modelContextOverrides.ts`)
- Avoid direct imports from `src/lib/localDb.ts` (compatibility barrel only; use owning domain modules instead)
- Exception: `src/lib/db/` internals may use the compatibility barrel during decomposition

## Error Handling

**Patterns:**
- All HTTP/SSE error responses route through `buildErrorBody()` or `sanitizeErrorMessage()` from `open-sse/utils/error.ts`
- Never expose raw `err.stack` or `err.message` in responses (stack traces and paths are redacted)
- Error response structure:
  ```typescript
  {
    error: {
      message: string;        // sanitized message
      type?: string;          // error category (e.g., "invalid_api_key")
      code?: string;          // error code
    };
    upstream_details?: Record<string, unknown> | null;  // sanitized upstream response
  }
  ```
- HTTP status codes follow REST conventions: 400 (bad request), 401 (auth), 403 (forbidden), 429 (rate limit), 500+ (server errors)
- Proper error context: include relevant identifiers (model, provider, account) but never credentials
- Logging: errors logged with pino using `log.error({ err, model, provider }, "message")`

## Logging

**Framework:** Pino (structured JSON logger)

**Patterns:**
- Create a child logger with context: `const log = logger.child({ module: "proxy", requestId: "..." })`
- Log with structured data: `log.info({ model: "gpt-4o" }, "Request received")`
- Error logging includes error object: `log.error({ err }, "Connection failed")`
- Log levels: `debug`, `info`, `warn`, `error` (set via `APP_LOG_LEVEL` env var, defaults to `debug` in dev, `info` in prod)
- Sensitive data (API keys, tokens, passwords) is automatically redacted via `redactLogArgs()` in logger hooks
- File rotation: logs written to `~/.omniroute/logs/` with automatic daily rotation
- Dev mode: pretty-printed to console via pino-pretty; production: JSON lines for log aggregation

## Comments

**When to Comment:**
- Non-obvious business rules that code structure alone cannot express
- Workarounds for external library bugs or platform limitations
- Complex regex patterns or mathematical formulas
- Critical warnings about side effects or non-obvious constraints
- Issue/PR numbers in code comments (e.g., `// #7879: explanation of workaround`)

**DO NOT use comments for:**
- Explanatory comments describing WHAT code does (code must be self-documenting via naming)
- Inline comments inside function bodies, loops, or conditionals
- Redundant docstrings/JSDoc (unless it's a public API or the project has an established convention)
- Section dividers or "helper" markers
- TODO/FIXME/HACK comments (unless explicitly requested and tracking an issue number)

**Comment style (when allowed):**
- One line, concise
- Explain WHY, never WHAT
- Must add information not derivable from code itself
- Example: `// Literal path so Webpack emits the chunk (computed string breaks dev: MODULE_NOT_FOUND)`

## Function Design

**Size:**
- Functions should be focused (single responsibility)
- Helper functions extracted when logic is repeated or becomes unreadable
- Average function length: 20-50 lines (not a hard rule, but a signal)

**Parameters:**
- Descriptive parameter names (e.g., `normalizeRequestedModelIds(searchParams, body)` not `normalize(a, b)`)
- Use object parameters for functions with many arguments (destructuring in signature)
- Type all parameters explicitly in TypeScript (no implicit `any`)

**Return Values:**
- Functions return single, well-typed values (not tuples unless semantically meaningful)
- Async functions return Promises
- Errors thrown, not returned as error objects (try/catch at boundaries)
- Null/undefined only when explicitly semantically meaningful (prefer typed unions like `Result<T>`)

## Module Design

**Exports:**
- Named exports preferred (allows tree-shaking and refactoring)
- Default exports used for page components in Next.js `page.tsx` and `layout.tsx`
- Barrel files (index.ts with re-exports) used for module boundaries only, not for convenience

**Barrel Files:**
- `src/lib/localDb.ts` is a read-only re-export layer during decomposition
- Real logic lives in domain modules under `src/lib/db/`
- Barrel imports discouraged outside of boundary modules

**Monorepo Workspace:**
- `open-sse/` is a separate workspace with its own package.json, tsconfig, and lint rules
- Import from `@omniroute/open-sse` or relative paths when crossing workspace boundary
- `src/` can import from `open-sse/` but not vice versa

## Type System

**Configuration:**
- TypeScript strict mode: OFF (`strict: false` in tsconfig.json)
- Incremental adoption of strictness in `open-sse/` (error boundaries, type safety for streaming)
- No implicit `any` in `open-sse/` and `tests/`
- Target: ES2022, Module: esnext, Resolution: bundler

**Practice:**
- All function parameters and return types should be explicit
- Use `unknown` for unconstrained inputs; narrow with `typeof` checks
- Use type guards (type predicates) for complex narrowing
- Avoid casting; prefer runtime validation with Zod schemas

---

*Convention analysis: 2026-08-14*
