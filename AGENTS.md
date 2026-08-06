# OmniRoute agent guide

## Project

OmniRoute is a unified AI proxy/router. The repository contains the Next.js application
(`src/`), streaming engine workspace (`open-sse/`), Electron desktop app (`electron/`),
CLI (`bin/`), and tests (`tests/`).

## Setup and focused checks

- Runtime: Node.js `>=22.22.3 <23` or `>=24.0.0 <27`; npm 10+.
- Install dependencies: `npm install`.
- Start development: `npm run dev`.
- Build: `npm run build`; release build: `npm run build:release`.
- Lint: `npm run lint`.
- Core type check: `npm run typecheck:core`.
- Run the most focused test for changed code first:
  `node --import tsx/esm --test tests/unit/<file>.test.ts`.
- Other suites: `npm run test:vitest`, `npm run test:e2e`,
  `npm run test:protocols:e2e`, and `npm run test:ecosystem`.
- Run `npm run check:docs-all` after changing documentation.

For the complete test matrix, coverage requirements, and pull-request gates, read
[`CONTRIBUTING.md`](CONTRIBUTING.md#running-tests).

## Documentation accuracy

Documentation must describe verified behavior, not plausible behavior.

1. Before documenting an API name, endpoint, path, CLI command, or environment variable,
   search for it: `rg -n "name" src/ open-sse/ bin/`. If it has no source match, do not
   document it.
2. Measure mutable counts instead of writing them from memory: use `wc -l <file>` or a
   directory-specific count command.
3. Copy code examples from working usage or run them. Prefer a source link such as
   `path/to/file.ts:line` to an invented signature.
4. Run `npm run check:docs-all` for edits under `docs/`; it includes the fabricated-docs
   validation.

## Code conventions

- Format with Prettier: two spaces, semicolons, double quotes, 100-character line width,
  and ES5 trailing commas. Run Prettier on changed files.
- TypeScript target is ES2022 with bundler module resolution. Prefer explicit types.
- Import order: external, internal (`@/` and `@omniroute/open-sse`), then relative.
- Do not add logic to `src/lib/localDb.ts`; import from the owning `src/lib/db/` module.
- Use specific errors and contextual logging. Do not silently swallow SSE-stream failures;
  use abort signals for cleanup and return appropriate HTTP status codes.

## Security requirements

- Never commit credentials or log SQLite encryption keys.
- Validate API inputs with Zod and use the route's required authentication path.
- Sanitize user HTML with DOMPurify.
- Use `resolvePublicCred()` for public upstream OAuth identifiers; never add them as string
  literals. See [`docs/security/PUBLIC_CREDS.md`](docs/security/PUBLIC_CREDS.md).
- Use `buildErrorBody()` or `sanitizeErrorMessage()` for HTTP, SSE, executor, and MCP errors;
  do not return raw `err.stack` or `err.message`. See
  [`docs/security/ERROR_SANITIZATION.md`](docs/security/ERROR_SANITIZATION.md).
- Pass runtime values to `exec()` or `spawn()` through `env`, not interpolation into a script.

## Repository map

Read the nearest `AGENTS.md` and the linked deep-dive before making a non-trivial change.

| Area                               | Location                                                | Start here                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| API routes                         | `src/app/api/v1/`                                       | [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)                                                                         |
| Streaming request handling         | `open-sse/handlers/`                                    | [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)                                                                         |
| Provider execution and translation | `open-sse/executors/`, `open-sse/translator/`           | [`docs/architecture/CODEBASE_DOCUMENTATION.md`](docs/architecture/CODEBASE_DOCUMENTATION.md)                                                     |
| Routing and resilience             | `open-sse/services/`                                    | [`open-sse/services/AGENTS.md`](open-sse/services/AGENTS.md), [`docs/routing/AUTO-COMBO.md`](docs/routing/AUTO-COMBO.md)                         |
| Database and migrations            | `src/lib/db/`, `db/migrations/`                         | [`src/lib/db/AGENTS.md`](src/lib/db/AGENTS.md)                                                                                                   |
| Domain policy                      | `src/domain/`                                           | [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)                                                                         |
| MCP and A2A                        | `open-sse/mcp-server/`, `src/lib/a2a/`                  | [`docs/frameworks/MCP-SERVER.md`](docs/frameworks/MCP-SERVER.md), [`docs/frameworks/A2A-SERVER.md`](docs/frameworks/A2A-SERVER.md)               |
| Agent features                     | `src/lib/{acp,memory,skills,cloudAgent}/`               | [`docs/frameworks/AGENT_PROTOCOLS_GUIDE.md`](docs/frameworks/AGENT_PROTOCOLS_GUIDE.md), [`docs/frameworks/SKILLS.md`](docs/frameworks/SKILLS.md) |
| Safety and governance              | `src/lib/{guardrails,compliance}/`, `src/server/authz/` | [`docs/security/GUARDRAILS.md`](docs/security/GUARDRAILS.md), [`docs/architecture/AUTHZ_GUIDE.md`](docs/architecture/AUTHZ_GUIDE.md)             |
| Operations                         | `src/mitm/`, tunnel modules, `electron/`                | [`docs/ops/TUNNELS_GUIDE.md`](docs/ops/TUNNELS_GUIDE.md), [`docs/guides/ELECTRON_GUIDE.md`](docs/guides/ELECTRON_GUIDE.md)                       |

## Review focus

- Keep database operations in `src/lib/db/`; do not issue raw SQL from routes.
- Send provider requests through `open-sse/handlers/`.
- Keep MCP and A2A pages as tabs inside `/dashboard/endpoint`.
- Preserve SSE cleanup, rate-limit header parsing, Zod validation, and provider-schema
  validation.
- Treat Memory and Skills as cross-cutting changes that can affect MCP tools, the request
  pipeline, and A2A skills.
- Do not close a contributor pull request after using its code; merge it through GitHub so
  the contributor receives credit.

## Upstream contributions

This checkout is a fork of `diegosouzapw/OmniRoute`. Keep fork-only deployment and personal
automation changes out of upstream PRs.

Start upstream work from the active upstream default branch, not `main`:

```bash
git fetch upstream
git switch -c <branch-name> upstream/<default-branch>
```

Target that same release branch in the pull request. Stage only the intended files, run the
focused checks, and use a Conventional Commit message (for example, `docs: slim AGENTS.md`).

## Fork-only changes (do not push to source)

**Local brand and design-system modifications stay in this fork only.** Do **not** open
PRs or push commits that touch the visual identity (brand color tokens, logo, marketing
page chrome, landing components, or any design system token override) to the upstream
`diegosouzapw/OmniRoute` repository. These are personal deployment preferences and
should never propagate back to the source of truth.

This means:

- `git push origin …` is fine — it publishes to the personal fork.
- `git push upstream …` for any commit that changes the brand identity is **prohibited**.
- The `feat(branding):` and `feat(theme):` commits merged into `release/v3.8.50` of
  this fork must not be cherry-picked, rebased, or PR'd onto `upstream/release/v3.8.50`.

Upstream still receives functional fixes, refactors, security patches, and i18n
contributions from this fork — only the brand identity surface is excluded.

## Engineering lessons learned

Hard-won knowledge from prior debugging sessions. Read this **before** the second dev
server boot fails — it shortens the diagnosis from ~30 min to ~2 min.

### 1. Turbopack + worktree junction is broken (run dev server from the main repo)

When using a git worktree with `node_modules` as a junction (reparse point) to the main
repo's `node_modules`:

- **Turbopack** rejects it with `Symlink [project]/node_modules is invalid, it points out
  of the filesystem root` and refuses to compile anything.
- **Webpack** does not error on the junction but silently breaks native module loading:
  the `instrumentation-node.ts` bundle compiles `const _require = createRequire(import.meta.url)`
  to `const _require = undefined`, so any `require('better-sqlite3')` / `require('node:sqlite')`
  inside `src/lib/db/adapters/driverFactory.ts` throws `Cannot find module '...'` and the
  dev server falls through to sql.js (which lacks FTS5 → migration 117 aborts).

**Workaround (canonical pattern):** run `npm run dev` from the **main repo** (Turbopack
on, real `node_modules/`, native bindings present). Use the worktree only as a git
work-area. For visual verification of worktree changes, copy the modified files into the
main repo's working tree, hot-reload picks them up; restore from the worktree after.

### 2. `node_modules/` may be silently incomplete (a prior cleanup deleted files)

Symptoms: dev server fails with `Cannot find module 'X'` while `node -e "require('X')"`
in a fresh shell succeeds. This means the **package's metadata is present but specific
files are missing** — usually native binding artifacts or CSS assets that the package's
"files" field ships but `npm install` won't re-fetch for already-installed packages.

Common casualties seen in this repo (in order of frequency):

- `@next/env/` — entire subdir may be wiped. `npm install --no-save` restores it.
- `better-sqlite3/build/Release/better_sqlite3.node` — fallback to the
  prebuild at `prebuilds/win32-x64.node`: `Copy-Item` it into `build/Release/`.
- `fumadocs-ui/css/*.css` — when missing, the `@import "fumadocs-ui/css/neutral.css"`
  in `src/app/globals.css` throws a CssSyntaxError. Fix by downloading the tarball
  (`https://registry.npmjs.org/fumadocs-ui/-/fumadocs-ui-16.13.0.tgz`) and extracting
  just the `css/` subtree into `node_modules/fumadocs-ui/`.

Diagnostic checklist (run from the project root):

```bash
Test-Path node_modules/@next/env/package.json
Test-Path node_modules/better-sqlite3/build/Release/better_sqlite3.node
Test-Path node_modules/fumadocs-ui/css/neutral.css
```

### 3. Font cascade: don't redeclare `--font-sans` / `--font-mono` in `@theme inline`

`next/font` (`Geist`, `Inter`, etc.) with `variable: "--font-sans"` injects a class on
`<body>` that defines `--font-sans` at body scope. If `globals.css` also defines
`--font-sans` in `@theme inline` at `:root`, the body-level value wins for `body
{ font-family: var(--font-sans) }` (good), **but** the `font-sans` Tailwind utility
class will resolve to the `:root` value instead — meaning the font *loads* but the
utility does not pick it up. This is the silent "Inter was loaded but the page still
uses SF Pro Text" bug.

**Rule:** if you use `next/font`, do not also redeclare the variable in `@theme inline`.
Either delete the system-font-stack line in `globals.css` or replace it with an inert
fallback (e.g. `--font-sans: ui-sans-serif, system-ui, sans-serif`) that documents
the intent and lets body scope win cleanly.

### 4. Background dev server tasks report "failed" at the 30-min hard timeout

Local background `bash` tasks that run `npm run dev` are killed by the harness at 30
minutes regardless of server health. The terminal "failed" status with `Command exited
with code 1` is the harness reporting the kill, not an application error. The dev server
is healthy right up to the kill — `GET /login 200` in the last seconds of the log is
proof. Restart and don't chase phantom errors from the final log lines.

## Reference documentation

Use the source of truth for the area you are changing:

| Area                                   | Reference                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository navigation and architecture | [`docs/architecture/REPOSITORY_MAP.md`](docs/architecture/REPOSITORY_MAP.md), [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)                                                                                                 |
| API and providers                      | [`docs/reference/API_REFERENCE.md`](docs/reference/API_REFERENCE.md), [`docs/reference/PROVIDER_REFERENCE.md`](docs/reference/PROVIDER_REFERENCE.md), [`docs/openapi.yaml`](docs/openapi.yaml)                                                         |
| Routing, resilience, and reasoning     | [`docs/routing/AUTO-COMBO.md`](docs/routing/AUTO-COMBO.md), [`docs/architecture/RESILIENCE_GUIDE.md`](docs/architecture/RESILIENCE_GUIDE.md), [`docs/routing/REASONING_REPLAY.md`](docs/routing/REASONING_REPLAY.md)                                   |
| Security                               | [`docs/security/GUARDRAILS.md`](docs/security/GUARDRAILS.md), [`docs/security/COMPLIANCE.md`](docs/security/COMPLIANCE.md), [`docs/security/STEALTH_GUIDE.md`](docs/security/STEALTH_GUIDE.md)                                                         |
| Platform features                      | [`docs/frameworks/MCP-SERVER.md`](docs/frameworks/MCP-SERVER.md), [`docs/frameworks/A2A-SERVER.md`](docs/frameworks/A2A-SERVER.md), [`docs/frameworks/SKILLS.md`](docs/frameworks/SKILLS.md), [`docs/frameworks/MEMORY.md`](docs/frameworks/MEMORY.md) |
| Releases and quality                   | [`docs/ops/RELEASE_CHECKLIST.md`](docs/ops/RELEASE_CHECKLIST.md), [`docs/architecture/QUALITY_GATES.md`](docs/architecture/QUALITY_GATES.md)                                                                                                           |
