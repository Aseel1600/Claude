# OmniRoute Roadmap

> Version-gated, not date-gated: each milestone ships when its quality gates pass.
> Current line: **v3.8.x** (this branch). Status snapshot: **2026-08-05**.

> **Active release state:** `release/v3.8.50` is in the **PREPARE / active-development**
> phase. The package version is `3.8.50`; the latest tag in this checkout is `v3.8.49`,
> so `3.8.50` is not yet a released or LTS line.

OmniRoute is heading from a monolithic router to a **modular AI platform**: a lightweight
core engine, a typed SDK, and everything else as installable modules and plugins. The path
runs through a stabilization rail (3.8.50 → 3.8.59), an LTS anchor (**3.9.0**), and the
modular **4.0**.

## The rail at a glance

```
3.8.50 ─ 3.8.54   PREPARE   non-breaking structural prep (all PRs welcome)
3.8.55 ─ 3.8.59   VALIDATE  stabilization (fixes / docs / i18n / providers only)
3.9.0             LTS       stable/v3 branch · long-term support line
4.0.0-nightly/rc  MODULAR   core + SDK + modules + marketplace (develop branch)
4.0.0             GA        latest switches to v4 · v3 stays supported as LTS
```

## Phase 1 — Preparation (3.8.50 → 3.8.54)

Non-breaking structural work that de-risks the modular split. Every version closes with a
mandatory quality-gate battery before new merges open.

| Version | Focus |
| --- | --- |
| 3.8.50 | CI safety net on release branches · dead-code cleanup · community-reported catalog/topology bug fixes · contributor "golden path" guide |
| 3.8.51 | Executor registry (in-place) · end-to-end provider-journey contract test becomes a CI gate · official scoped-test dev loop · CI lane consolidation (shared install/setup across gate jobs, #8084) |
| 3.8.52 | `combo.ts` decomposition · routing-strategy registry · unified model-catalog contract for `/v1/models` · one CI policy for PRs to `release/**` and `main` (#8084) |
| 3.8.53 | `chatCore.ts` decomposition · headless mode (`OMNIROUTE_HEADLESS=1`) · local candidate build/promote loop |
| 3.8.54 | Release infrastructure and merge-queue preparation: channels, labels, PR templates, merge queue · full-regression authority moves to the merge queue once TIA shadow evidence clears (#8084) · public feature-freeze announcement |

## Current status snapshot — 2026-08-05

This section records implementation evidence separately from release completion. A capability
being present in the tree does not by itself close a version milestone; closure requires the
milestone's quality gates and release decision to pass.

| Signal | Current evidence | Status interpretation |
| --- | --- | --- |
| Branch and package | [`release/v3.8.50`](https://github.com/diegosouzapw/OmniRoute/tree/release/v3.8.50), package `3.8.50`, latest local tag `v3.8.49` | 3.8.50 development cycle is active; no 3.8.50 release has been cut |
| Release hardening | [clean-install/upgrade publish gate](https://github.com/diegosouzapw/OmniRoute/commit/7eca04fd1), [release PR build gate](https://github.com/diegosouzapw/OmniRoute/commit/2a0b1755c), [base-red repairs](https://github.com/diegosouzapw/OmniRoute/commit/ef3f55466) | Significant PREPARE work is landed; final release readiness is still open |
| Scoped verification | [TIA-based scoped test runner](https://github.com/diegosouzapw/OmniRoute/commit/b38f3a4c0), [runtime combo-strategy check](https://github.com/diegosouzapw/OmniRoute/commit/0ef50886e) | Local/CI feedback loops are implemented; full release evidence remains required |
| Current quality work | [adaptive admission coverage](https://github.com/diegosouzapw/OmniRoute/commit/2c966c28a), [quality baseline hardening](https://github.com/diegosouzapw/OmniRoute/commit/9fcefcce9) | The branch is still actively hardening quality gates |
| Local verification | Dependencies are not installed in this checkout | Tests/builds have not been run locally in this snapshot |

### Milestone status

| Milestone | Status | Evidence and remaining work |
| --- | --- | --- |
| 3.8.50 | **In progress** | The cycle opened on [2026-07-28](https://github.com/diegosouzapw/OmniRoute/commit/ed2db6cb1) and continues through release-hardening, provider fixes, quality baselines, and base-red repairs. Cut the release only after the full gate battery and release checklist pass. |
| 3.8.51 | **Partially evidenced; not closed** | Provider-journey coverage exists in [the contract-test commit](https://github.com/diegosouzapw/OmniRoute/commit/0d92be211), and executor contracts/registry wiring are present. The milestone needs an explicit release-gate decision before it can be treated as complete. |
| 3.8.52 | **Partially evidenced; not closed** | Combo extraction landed through [target-resolution decomposition](https://github.com/diegosouzapw/OmniRoute/commit/0eeb8f45d), the routing strategy registry exists in `open-sse/services/autoCombo/routerStrategy.ts`, and the unified model catalog is used by `/v1/models`. Characterization and coupling gates still determine closure. |
| 3.8.53 | **Not evidenced as complete** | Combo decomposition is progressing, but no runtime implementation of the roadmap's explicit `OMNIROUTE_HEADLESS=1` flag or complete candidate build/promote loop was found in the current source snapshot. Treat these as open work. |
| 3.8.54 | **Partially evidenced; not closed** | Release infrastructure is active through [quality-rail work](https://github.com/diegosouzapw/OmniRoute/commit/45c91e22c), [release-process fixes](https://github.com/diegosouzapw/OmniRoute/commit/494b1c961), and merge-queue tolerance [work](https://github.com/diegosouzapw/OmniRoute/commit/2e4268003). Feature-freeze and the final full-regression authority decision remain open. |
| 3.8.55–3.8.59 | **Future validation rail** | Characterization, canary/performance, security/compliance, 3.9.0 cut rehearsal, and final GO/NO-GO gates have not been marked complete in this checkout. |

### Release-readiness decision

**Decision: NO-GO for a 3.8.50 release at this snapshot.** The branch has substantial
quality and release infrastructure, but the release is not tagged, local dependencies are
absent, the full verification matrix has not been run from this checkout, and the milestone
closure evidence above is not yet complete. The next release decision should record the exact
CI run, build artifact, test/coverage result, security result, and release checklist outcome.

### Evidence maintenance rule

When a milestone closes, update its row with the closing commit or PR, the quality-gate run,
and the release decision. Keep future milestones explicitly labelled as planned rather than
implying that source presence alone means the milestone shipped.

## Phase 2 — Validation (3.8.55 → 3.8.59)

**External feature PRs pause here** (they get the `v4-feature` label and are re-targeted to
the v4 channel when it opens). Fixes, docs, i18n, and provider updates keep flowing.

| Version | Focus |
| --- | --- |
| 3.8.55 | Characterization tests for every extraction candidate · coupling re-measurement |
| 3.8.56 | Extended canary · performance baselines (heap, TTFB, build) |
| 3.8.57 | Security & compliance sweep · publish provenance (OIDC) rehearsal |
| 3.8.58 | Full dry-run of the 3.9.0 cut (branches, channels, forward-port) — includes the PR preview-artifact + build-once promotion rehearsal (#8084) |
| 3.8.59 | Final freeze · full-suite audit · GO/NO-GO |

## Phase 3 — v3.9.0 LTS

After 3.8.59 the next version is **3.9.0** (there is no 3.8.60). It creates the long-lived
branch model:

- **`stable/v3`** — the LTS line (3.9.x). Receives fixes, security patches, and provider
  updates. `npm install omniroute` (aka `latest`) stays on v3 during the whole v4 cycle.
- **`develop`** — v4 development, published as `4.0.0-nightly.*`.
- **`main`** — v4 release candidates (`next`) and, eventually, GA.
- Fixes merged to `stable/v3` are automatically forward-ported to `develop` with full
  contributor credit (`Co-authored-by`).

New features land in the v4 channel. The LTS line is stability-first.

## Phase 4 — v4.0: the modular platform

The monolith is intentionally disassembled on `develop`:

- **`@omniroute/core`** (npm name stays `omniroute`) — just the engine: `/v1/*`, routing,
  combo/fallback, providers.
- **`@omniroute/sdk`** — one typed contract: hooks, extension points, two-phase lifecycle,
  UI contributions. The five extension systems that exist today (plugins, CLI plugins,
  skills, MCP tools, A2A skills) collapse into one declarative manifest.
- **Modules** (`@omniroute/mod-*`) — cloud agents, traffic inspection (MITM), evals,
  webhooks, memory, guardrails, observability and more move out of the core, each with its
  own version and lifecycle.
- **Providers as plugins** — adding a provider stops touching the core.
- **Marketplace** — one-click install with verified integrity (hash pinning, signing,
  sandbox). Free in v1; a paid tier later with revenue share for creators.
- Ships as `4.0.0-nightly.*` → `4.0.0-rc.N` (soak in production) → **4.0.0 GA**, when
  `latest` switches to v4 and v3 enters its announced LTS support window.

**The core is MIT and free, forever.**

## For contributors

| You are sending... | Target today | From 3.8.55 | After 3.9.0 |
| --- | --- | --- | --- |
| Bug fix / security | active `release/v3.8.x` | same | `stable/v3` |
| Provider update | active `release/v3.8.x` | same | `stable/v3` |
| Docs / i18n | active `release/v3.8.x` | same | `stable/v3` |
| New feature | active `release/v3.8.x` | held with `v4-feature` label | `develop` (v4) |

See `CONTRIBUTING.md` for the golden path per change type.
