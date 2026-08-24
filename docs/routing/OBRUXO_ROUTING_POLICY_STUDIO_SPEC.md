---
title: "Obruxo Routing Policy Studio — Feature Specification"
status: proposed
created: 2026-08-22
---

# Obruxo Routing Policy Studio

## 1. Summary

Create a dashboard experience for managing the routing policy of a persisted Auto Combo, initially the `obruxo` combo. The feature makes model-pool selection, Auto Combo scoring configuration, task-fitness overrides, operational safeguards, and routing evidence visible and editable without direct SQLite changes.

The feature uses existing persisted combo configuration and existing Auto Combo runtime behavior. It does not replace the router, provider credential handling, circuit breaker, or call logging.

## 2. Problem

The current routing behavior is distributed across:

- persisted combo data in the `combos` table;
- user fitness overrides in the `model_intelligence` table;
- code defaults in `open-sse/services/autoCombo/scoring.ts`, `modePacks.ts`, and `taskFitness.ts`;
- runtime telemetry, resilience state, quota state, session affinity, and combo metrics.

The dashboard exposes generic combo editing, but it does not provide one focused interface that answers these operational questions for `obruxo`:

1. Which models can the combo select and in what order or relative preference?
2. Which scoring policy is active, and which factors influenced a selected model?
3. Which fitness settings are customized for coding, analysis, vision, and tool-use work?
4. Which candidates are currently unavailable because of quota, credentials, cooldown, or circuit breaker state?
5. What would the router select for a representative request, and why?
6. What changed in the routing policy and how can an operator restore a previous configuration?

## 3. Goals

1. Provide a management-authenticated UI for the `obruxo` Auto Combo.
2. Persist supported policy settings through existing combo and model-intelligence persistence paths.
3. Make the effective routing policy inspectable without revealing credentials or request content.
4. Provide a deterministic, non-dispatching routing simulation.
5. Provide an audit trail and a rollback action for persisted policy edits.
6. Preserve current request behavior when no policy changes are made.

## 4. Non-goals

- Replace the Auto Combo scoring algorithm.
- Expose provider API keys, OAuth tokens, connection secrets, raw authorization headers, or raw request bodies.
- Modify live health, quota, circuit-breaker, latency, or cache-affinity values manually.
- Guarantee exact routing reproduction when runtime signals change between simulation and dispatch.
- Modify the external VS Code extension protocol in this feature.
- Infer an agent role from prompt text as a persisted fact.

## 5. Existing System Contracts

### 5.1 Persisted combo

The existing `combos` record stores the concrete Auto Combo definition, including its model steps, `strategy`, and `config`. Supported updates are validated by `updateComboSchema` and handled by `PUT /api/combos/[id]`.

For `obruxo`, the feature may manage only fields already accepted by the combo schema, including:

- `models`;
- `strategy` (the Studio must require `auto` for the managed combo);
- `config.modePack`;
- `config.weights`;
- `config.explorationRate`;
- budget and SLA options already recognized by the combo runtime;
- context-related settings already recognized by the combo schema.

### 5.2 Model fitness

`model_intelligence` supports user overrides. The task-fitness resolver gives a user override precedence over Arena ELO, Models.dev tier data, and static fitness data.

The Studio must write only source-qualified `user_override` entries. It must not alter synchronized Arena ELO or Models.dev records.

### 5.3 Runtime selection

The Auto Combo runtime builds eligible candidates, filters unavailable or quota-blocked candidates, classifies request intent, scores candidates, and selects a target. Current scoring factors include quota, health, cost, latency, task fit, stability, tier characteristics, context/cache affinity, reset-window affinity, and connection density.

Runtime health and telemetry remain read-only inputs to the Studio.

### 5.4 Existing per-request controls

The router already accepts request-level controls for mode and budget. The Studio configures persisted defaults; it must not change the precedence of per-request controls.

## 6. Users and Permissions

| User                  | Permission                   | Capability                                                                           |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| Operator              | Management authentication    | View policy, telemetry, simulation, audit history; save and rollback policy changes. |
| Non-management caller | Existing API-key permissions | No Studio access and no policy mutation.                                             |
| Runtime router        | Internal service             | Reads persisted policy and live signals; does not require UI access.                 |

All Studio APIs require the same management authorization used by existing combo management routes.

## 7. User Experience

Add **Routing Policy** as a dedicated view under the combo dashboard, with direct entry for `obruxo` and a reusable route parameter for future persisted Auto Combos.

### 7.1 Policy overview

Display:

- combo name, description, version/update time, and active status;
- strategy and active mode pack;
- configured model steps and structural weights;
- effective scoring weights after mode-pack resolution;
- active budget, exploration, and SLA settings;
- current request distribution, success rate, average latency, P95 latency, and fallback rate from existing combo metrics.

### 7.2 Model pool editor

Allow an operator to:

- add a model step from an available configured provider/model;
- remove a model step;
- enable/disable a model step without deleting its configuration;
- set model-step label and relative weight where the existing step contract supports it;
- reorder priority-oriented steps;
- view provider, model, context limit where known, and current health/availability summary.

Validation:

- reject duplicate model-step IDs;
- reject invalid provider/model combinations;
- reject empty enabled pool;
- preserve compatibility with structured `ComboStep` objects and combo references;
- show unavailable candidates but do not allow the UI to bypass credential, quota, or resilience gates.

### 7.3 Scoring policy editor

Provide:

- a mode-pack selector: default/balanced, `ship-fast`, `cost-saver`, `quality-first`, `offline-friendly`, and `reliability-first` when present in the runtime catalog;
- an advanced toggle exposing supported scoring weights;
- a normalized total indicator; save must use the server-side weight normalization/validation behavior;
- reset actions for the active mode pack and the global default;
- explanation text identifying runtime-only factors that cannot be manually set.

A custom `config.weights` must take effect only when no selected `modePack` overrides it. The UI must clearly state the effective precedence before save.

### 7.4 Task-fitness overrides

Display a matrix of models by task category supported by the current router. The initial role-oriented labels map to existing task categories as follows:

| Studio label  | Existing routing category                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| Coder         | `coding`                                                                        |
| Analyser      | `analysis`                                                                      |
| Reviewer      | `review`                                                                        |
| Planner       | `planning`                                                                      |
| Debugger      | `debugging`                                                                     |
| Documentation | `documentation`                                                                 |
| Vision        | No persisted fitness category in this release; show telemetry/eligibility only. |
| Tool use      | No persisted fitness category in this release; show capability/telemetry only.  |

For supported categories, operators can set a score from 0 to 1 for a model. The UI must show whether the effective score comes from a user override, Arena ELO, Models.dev tier data, static fitness, or wildcard logic.

Clearing an override restores normal resolver precedence.

### 7.5 Routing simulator

The simulator accepts a sanitized request profile:

- task category (optional; otherwise use the router classifier);
- approximate input token count;
- has-tools boolean;
- desired mode pack override (optional);
- desired budget cap override (optional);
- optional session-affinity context represented only by model/provider identifiers.

The simulator returns:

- effective candidate pool;
- exclusions with safe reasons such as `quota_cutoff`, `circuit_open`, `cooldown`, `model_excluded`, `no_credentials`, or `context_window`;
- effective weights and each score factor;
- ranked candidates and selected candidate;
- whether the result contains randomized exploration and, if so, the deterministic seed or the non-exploration baseline;
- a disclaimer that live routing can differ due to changing quota, health, metrics, and session state.

The simulator must not call a provider, consume quota, write call logs, or persist request text.

### 7.6 Operational telemetry

Show current aggregate data from existing combo metrics and call-log-derived analytics where available:

- requests, success rate, fallback rate;
- average and P95 latency by target;
- selection count by final model/provider;
- observed errors grouped by safe normalized reason;
- classified intent counts.

If an agent role is not explicitly supplied by the caller, the UI must label any role view as **inferred** and display the classifier method. It must not represent inferred roles as caller-provided metadata.

### 7.7 Audit and rollback

Every persisted policy save creates an immutable audit entry containing:

- audit ID;
- actor identity if available through management authentication;
- timestamp;
- target combo ID and name;
- sanitized before/after policy snapshots;
- changed field paths;
- action type (`update`, `fitness_override_set`, `fitness_override_clear`, `rollback`);
- source version used for rollback.

The UI must support viewing a diff and rolling back a prior policy snapshot. A rollback creates a new audit entry; audit rows are never edited or deleted through the Studio.

## 8. API Contract

All endpoints are management-authenticated and must return sanitized errors.

### 8.1 Get policy

`GET /api/combos/{id}/routing-policy`

Response includes:

- persisted combo policy;
- effective mode-pack/weight presentation;
- supported mode packs and task categories;
- model pool metadata safe for the dashboard;
- user overrides and their effective-source information;
- read-only runtime status summary;
- latest audit revision identifier.

### 8.2 Update policy

`PUT /api/combos/{id}/routing-policy`

Accepts a subset of the existing combo update contract plus policy-specific intent fields. The server translates only validated supported fields to the existing combo update path.

Requirements:

- require `strategy: auto` for policy-managed Auto Combos;
- validate through the existing combo validation path;
- apply one atomic persisted combo update;
- write an audit entry after successful persistence;
- return the effective persisted policy and audit revision.

### 8.3 Fitness overrides

`GET /api/combos/{id}/routing-policy/fitness`

Returns effective fitness values and their sources for the combo’s model pool and supported categories.

`PUT /api/combos/{id}/routing-policy/fitness`

Sets one or more validated user overrides.

`DELETE /api/combos/{id}/routing-policy/fitness/{model}/{category}`

Clears the corresponding user override.

Each mutation writes an audit entry.

### 8.4 Simulation

`POST /api/combos/{id}/routing-policy/simulate`

Accepts the sanitized profile described in section 7.5. Returns an explainable non-dispatch decision.

### 8.5 Audit history and rollback

`GET /api/combos/{id}/routing-policy/audit`

Supports bounded pagination and returns sanitized diffs/snapshots.

`POST /api/combos/{id}/routing-policy/rollback`

Requires an audit revision ID. Restores only supported policy fields; it must not restore credentials, runtime state, quota, or telemetry.

## 9. Persistence

### 9.1 Existing tables

| Data                                          | Storage                                      |
| --------------------------------------------- | -------------------------------------------- |
| Combo model pool and Auto Combo configuration | `combos.data`                                |
| User task-fitness overrides                   | `model_intelligence`, source `user_override` |
| Existing call summaries                       | Current call-log storage                     |

### 9.2 New audit table

Add a dedicated append-only table, proposed name `routing_policy_audit`.

| Column               | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `id`                 | Primary identifier.                                 |
| `combo_id`           | Target combo identifier.                            |
| `combo_name`         | Snapshot-friendly target name.                      |
| `action`             | Mutation or rollback action.                        |
| `actor_id`           | Authenticated actor identifier when available.      |
| `before_json`        | Sanitized policy snapshot before mutation.          |
| `after_json`         | Sanitized policy snapshot after mutation.           |
| `changed_paths_json` | Field-level change list.                            |
| `source_audit_id`    | Source revision for a rollback, nullable otherwise. |
| `created_at`         | Immutable event timestamp.                          |

The snapshot schema must deliberately exclude credentials, API keys, OAuth data, full call-log request bodies, and live provider runtime state.

## 10. Routing Rules and Precedence

The following precedence remains explicit:

1. Per-request supported routing controls take precedence for that request.
2. Persisted `combo.config.modePack`, when defined, supplies effective scoring weights.
3. Persisted `combo.config.weights` applies when no mode pack supersedes it.
4. Global default scoring weights are fallback behavior.
5. Task fitness resolution remains: user override → Arena ELO → Models.dev tier → static table → wildcard boost/default.
6. Candidate filtering for credentials, model exclusions, quota cutoff, circuit breaker, cooldown, context limits, and resilience policy occurs before final selection.
7. Runtime state can change the selected candidate after a policy is saved or simulated.

## 11. Security and Data Handling

- Require management authentication on all policy endpoints and UI data loads.
- Use existing safe error response utilities; never return raw provider errors.
- Do not expose secret-bearing provider-connection fields.
- Do not persist simulator prompt text. Accept a profile, not a free-form raw prompt, for the first release.
- Sanitize audit snapshots and server logs.
- Validate model IDs, categories, numeric score ranges, pagination bounds, and payload size.
- Treat client-provided role metadata as untrusted input; display it as provided metadata only after schema validation.

## 12. Acceptance Criteria

| ID  | Requirement                                                                               | Evidence                                                                                                         |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AC1 | An operator can view the persisted `obruxo` policy and its effective score configuration. | Management-authenticated UI and API show combo model pool, mode pack, weights, and runtime summary.              |
| AC2 | An operator can update supported Auto Combo policy fields without direct DB access.       | Valid update persists through the combo update path and survives process restart.                                |
| AC3 | Invalid policies are rejected without partial persistence.                                | Integration tests cover invalid weights, empty enabled pool, invalid model step, and non-auto combo restriction. |
| AC4 | Fitness overrides can be set and cleared with correct resolver precedence.                | Tests verify `user_override` wins and clearing restores the next available source.                               |
| AC5 | Simulation is explainable and non-dispatching.                                            | Tests assert ranked factors/exclusions and assert no provider executor, quota use, or call log is created.       |
| AC6 | Dashboard telemetry identifies target distribution and runtime health without secrets.    | UI/API tests verify sanitized telemetry payload and absence of credential fields.                                |
| AC7 | Every mutation and rollback produces an immutable audit event.                            | Integration tests verify before/after snapshots, changed paths, and rollback lineage.                            |
| AC8 | Existing routing behavior is unchanged when the Studio is unused.                         | Regression tests for current Auto Combo selection and combo update endpoints pass unchanged.                     |

## 13. Delivery Plan

### Phase 1 — Read-only policy visibility

- Policy GET endpoint.
- Dashboard overview, model pool, effective weights, and read-only telemetry.
- No new persistence beyond existing tables.

### Phase 2 — Safe policy editing

- Reuse validated combo update path.
- Mode pack and advanced weights editor.
- Model pool editor.
- Audit table and mutation records.

### Phase 3 — Fitness management

- Fitness source display.
- User override set/clear endpoints.
- Fitness matrix UI.

### Phase 4 — Simulation and rollback

- Non-dispatch simulator using shared selection/scoring logic.
- Audit diff, restore, and rollback workflow.

### Phase 5 — Explicit agent-role contract (separate feature)

- Define and version caller-provided agent-role metadata.
- Extend client integrations only after the routing server accepts, validates, logs, and uses the metadata.
- Add `vision` and `tool-use` fitness policies only if the routing task taxonomy is expanded with explicit server support.

## 14. Open Decisions

1. Should policy management be limited to `obruxo` in the first UI release or enabled for every persisted Auto Combo?
2. What operator identity is reliably available from management authentication for audit attribution?
3. Should the model-pool editor use existing model-step `weight` only, or should Auto Combo receive an explicit model-step preference factor? The current runtime scoring contract must not be described as consuming a step weight unless validated in the selection path.
4. Should simulation include a server-side prompt classifier option in a later release, with strict redaction and retention rules?
5. Should runtime metrics gain durable historical aggregation beyond existing in-memory combo metrics and call logs?

## 15. Risks

| Risk                                                           | Mitigation                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| UI suggests a deterministic route while runtime state changes. | Label results as a point-in-time simulation and expose exclusions/factors.          |
| Operators set weights that reduce reliability.                 | Server validation, reset controls, audit history, and rollback.                     |
| Policy endpoints leak operational or credential data.          | Explicit response DTOs, management auth, sanitization tests.                        |
| Fitness overrides mask live intelligence indefinitely.         | Show source and override state prominently; provide one-click clear.                |
| Policy duplication diverges from router semantics.             | Reuse shared scoring/selection helpers; contract-test simulator against the router. |

## 16. Documentation Updates Required at Implementation

When implementation starts, update:

- `docs/routing/AUTO-COMBO.md` for persisted policy and precedence behavior;
- dashboard user documentation for policy editing and simulation;
- API documentation/OpenAPI for new management endpoints;
- migration documentation for `routing_policy_audit`.
