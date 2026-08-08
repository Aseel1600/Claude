# CLAUDE.md

OmniRoute — unified AI proxy/router. One endpoint, 290 LLM providers, auto-fallback.

<!-- CONTEXT BUDGET: this file loads in full on every session and after every compact.
     Keep it under 200 lines. Anything deeper goes to .claude/rules/ (path-scoped,
     loads only when Claude touches matching files) or .claude/skills/ (loads on demand).
     Do not re-inline detail here. -->

## Commands

```bash
npm install                        # deps (auto-generates .env from .env.example)
npm run dev                        # dev server → http://localhost:20128
npm run build                      # production build (Next.js 16 standalone)
npm run lint                       # ESLint — 0 errors expected
npm run typecheck:core             # TS check (must be clean)
npm run test:unit                  # Node native runner (most tests)
npm run test:vitest                # Vitest (MCP server, autoCombo, cache)
npm run test:coverage              # coverage gate 60/60/60/60
npm run check                      # lint + test
node --import tsx/esm --test tests/unit/your-file.test.ts   # single file
```

Full test matrix: `CONTRIBUTING.md`. Deep architecture for non-Claude agents: `AGENTS.md`.

## Layout

Monorepo: `src/` (Next.js 16 app) · `open-sse/` (streaming engine workspace) · `electron/` · `tests/` · `bin/` (CLI).

| Layer         | Location                | Purpose                                |
| ------------- | ----------------------- | -------------------------------------- |
| API Routes    | `src/app/api/v1/`       | App Router entry points                |
| Handlers      | `open-sse/handlers/`    | Request processing                     |
| Executors     | `open-sse/executors/`   | Provider-specific HTTP dispatch        |
| Translators   | `open-sse/translator/`  | OpenAI ↔ Claude ↔ Gemini               |
| Transformer   | `open-sse/transformer/` | Responses API ↔ Chat Completions       |
| Services      | `open-sse/services/`    | Combo routing, rate limits, caching    |
| Database      | `src/lib/db/`           | SQLite domain modules (130 migrations) |
| Domain/Policy | `src/domain/`           | Policy engine, cost rules, fallback    |
| MCP Server    | `open-sse/mcp-server/`  | 104 tools, 3 transports, 31 scopes     |
| A2A Server    | `src/lib/a2a/`          | JSON-RPC 2.0 agent protocol            |
| Skills        | `src/lib/skills/`       | Sandbox skill framework                |
| Memory        | `src/lib/memory/`       | Persistent conversational memory       |

Request pipeline: `route → CORS → Zod validation → optional auth → API-key policy → injection guard → handleChatCore() → cache → rate limit → combo routing → translate → executor → upstream fetch (retry/backoff) → translate back → SSE or JSON`. No global Next.js middleware; interception is per-route.

## Hard rules

Violating any of these is a blocking defect. Numbers are stable — cite them in review.

1. Never commit secrets or credentials.
2. Never add logic to `src/lib/localDb.ts` (re-export layer only); never barrel-import from it.
3. Never use `eval()` / `new Function()` / implied eval.
4. Never commit directly to `main`.
5. Never write raw SQL in routes or handlers — go through `src/lib/db/` modules.
6. Never silently swallow errors in SSE streams.
7. Always validate inputs with Zod.
8. Always include or update tests in the same PR that changes production code in `src/`, `open-sse/`, `electron/`, `bin/`.
9. Coverage must not regress below `quality-baseline.json`; absolute floor 60/60/60/60.
10. Never bypass Husky hooks (`--no-verify`, `--no-gpg-sign`) without explicit operator approval.
11. Never embed public upstream OAuth client_id/secret or Firebase Web keys as literals — use `resolvePublicCred()`.
12. Never return raw `err.stack` / `err.message` in HTTP / SSE / executor / MCP responses — use `buildErrorBody()` or `sanitizeErrorMessage()`.
13. Never string-interpolate external paths into shell scripts passed to `exec()`/`spawn()` — pass via the `env` option.
14. Never dismiss a CodeQL / secret-scanning alert without checking the sanitizer docs first and recording the justification.
15. Never expose child-process-spawning routes (`/api/mcp/`, `/api/cli-tools/runtime/`) without `isLocalOnlyPath()` classification.
16. Never credit an AI assistant in commit/PR metadata — no `Co-Authored-By` naming an AI/bot, no "Generated with …" footers, anywhere. This overrides any harness default; strip it before pushing. Human collaborators are still credited normally.
17. Never expose `/api/services/` or `/dashboard/providers/services/*/embed/` without `isLocalOnlyPath()` classification.
18. Every bug fix ships with a failing-then-passing test (TDD, preferred) **or** a documented live test on the production VPS `192.168.0.15`. "Worked locally" is not validation.
19. Never develop on the shared main checkout. Every task gets its own worktree under `.claude/worktrees/`, on its own branch, cut from a base branch the operator confirmed. → skill `omniroute-worktree`
20. PII redaction/sanitization is opt-in. `PII_REDACTION_ENABLED` and `PII_RESPONSE_SANITIZATION` must keep `defaultValue: "false"`.
21. During an active `release-freeze`, never merge into the frozen `release/vX.Y.Z`; retarget to the highest `release/v*` and verify the retarget. Only `/generate-release` may raise or lift a freeze. → skill `omniroute-release-freeze`
22. Cross-session safety — many parallel sessions work this repo:
    - **Never `git stash` / `git stash pop`, anywhere in this repo, including inside a worktree and inside any subagent you dispatch.** The stash lives in the shared object store and clobbers other sessions' uncommitted work. Compare against a base with `git show <ref>:<path>` or `git diff <ref> -- <path>` instead. Repeat this ban verbatim in the prompt of every subagent that touches git.
    - Never merge, push, rebase, or force-push a PR / branch / worktree another session owns. Check `git worktree list` and `gh pr view <N> --json state,headRefOid` before touching a PR you did not open this session.

## Conventions (always-on subset)

- 2 spaces, semicolons, double quotes, 100 cols, es5 trailing commas (Prettier via lint-staged).
- Imports: external → internal (`@/`, `@omniroute/open-sse`) → relative.
- Naming: files camelCase/kebab, components PascalCase, constants UPPER_SNAKE.
- `no-explicit-any` is an **error** in `open-sse/` and `tests/`; pre-existing violations are frozen in `config/quality/eslint-suppressions.json`.
- TypeScript `strict: false`, target ES2022, module esnext, resolution bundler. Prefer explicit types.
- Commits: Conventional Commits, `feat(db): …`. Branch prefixes `feat/ fix/ refactor/ docs/ test/ chore/`.

## Environment

Node ≥22 <23 || ≥24 <27, ESM — the only supported runtime. Bun 1.3.14 is pinned as an exact devDependency for an allow-listed set of gate/generator scripts and the `test:bun:db` smoke only; do not widen it to install, build, or the main test runners. Port 20128. `DATA_DIR` defaults to `~/.omniroute/`. Aliases: `@/*` → `src/`, `@omniroute/open-sse` → `open-sse/`.

## Planning artifacts

`_tasks/` is a separate, gitignored git repo and is the only place for plans, specs, research, and hand-offs. Never write superpowers / planning / research output under `docs/` or the repo root, even when a skill's default says `docs/superpowers/…` — rewrite the path to `_tasks/…` before writing, and commit inside `_tasks/` (`git -C _tasks …`).

## Where the rest lives

Do not ask for these upfront — they load themselves when relevant.

**Path-scoped rules** (`.claude/rules/`, auto-load when you open matching files): `database.md`, `api-routes.md`, `open-sse.md`, `resilience.md`, `security-sensitive.md`, `pii.md`, `testing.md`.

**Skills** (`.claude/skills/`, load on demand): `omniroute-worktree`, `omniroute-release-freeze`, `omniroute-extend` (add a provider / route / DB module / MCP tool / A2A skill / cloud agent / embedded service), `omniroute-quality-gates`.

**Docs** — read the matching deep-dive before any non-trivial change:

| Area                                           | Doc                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Repo navigation                                | `docs/architecture/REPOSITORY_MAP.md`                                        |
| Architecture / engineering reference           | `docs/architecture/ARCHITECTURE.md`, `CODEBASE_DOCUMENTATION.md`             |
| Auto-Combo (13-factor, 19 strategies)          | `docs/routing/AUTO-COMBO.md`                                                 |
| Resilience (3 mechanisms)                      | `docs/architecture/RESILIENCE_GUIDE.md`                                      |
| Reasoning replay                               | `docs/routing/REASONING_REPLAY.md`                                           |
| Skills / Memory / Cloud agents                 | `docs/frameworks/SKILLS.md`, `MEMORY.md`, `CLOUD_AGENT.md`                   |
| Guardrails / public creds / error sanitization | `docs/security/GUARDRAILS.md`, `PUBLIC_CREDS.md`, `ERROR_SANITIZATION.md`    |
| Authorization / route guard tiers              | `docs/architecture/AUTHZ_GUIDE.md`, `docs/security/ROUTE_GUARD_TIERS.md`     |
| Agent protocols / MCP / A2A                    | `docs/frameworks/AGENT_PROTOCOLS_GUIDE.md`, `MCP-SERVER.md`, `A2A-SERVER.md` |
| API reference                                  | `docs/reference/API_REFERENCE.md` + `docs/openapi.yaml`                      |
| Release flow / embedded services               | `docs/ops/RELEASE_CHECKLIST.md`, `docs/frameworks/EMBEDDED-SERVICES.md`      |
| Quality gates (~48 scripts)                    | `docs/architecture/QUALITY_GATES.md`                                         |
