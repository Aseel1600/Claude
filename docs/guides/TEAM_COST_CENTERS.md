---
title: "Team Cost Centers and Shared Budgets"
---

# Team cost centers and shared budgets

OmniRoute Team cost centers group independently managed API keys under one billing owner. They are deliberately separate from API-key groups:

```text
API Key --< key_group_members >-- Key Groups   # many-to-many model ACL
API Key --1 active billing binding--> Team     # one billing owner at a time
```

Keep one API key per person, agent, or application. Per-key model access, revocation, request limits, token limits, and audit identity continue to apply. A Team adds shared attribution, reporting, and an optional shared budget window; it does not replace those controls.

## Cost semantics

Team APIs use distinct fields rather than treating every dollar-looking value as an invoice:

- `estimatedListCostUsd`: token usage evaluated against OmniRoute's model pricing catalog. This is the phase-1 Team budget metric.
- `actualProviderCostUsd`: provider-reported or invoiced cost when available. Phase 1 returns `null` rather than substituting an estimate.
- `subscriptionQuotaUsed`: provider subscription quota units, when available. Phase 1 returns `null`.
- `compressionSavingsUsd`: estimated savings caused by compression. Phase 1 returns `null` in Team reports; existing compression analytics remain authoritative.

For subscription-backed providers, `estimatedListCostUsd` is useful for allocation and comparison but is not necessarily an invoiceable provider cost.

## Immutable attribution

When usage is written, OmniRoute resolves the API key's active billing Team at the request timestamp and stores that Team ID on the usage row. Reassigning a key affects future usage only; it does not rewrite historical ownership.

Before raw usage retention cleanup, Team usage is rolled into `daily_team_usage_summary`, preserving Team, API key, provider, model, service tier, token classes, and successful-request counters.

## Shared budget behavior

A Team may define:

- `maxBudgetUsd`
- `budgetDuration`: `1d`, `7d`, or `30d`

Phase 1 enforcement mode is explicitly `soft_committed_usage`. Before a request, OmniRoute sums committed successful usage in the active Team window using `estimatedListCostUsd` and rejects new traffic after the cap is reached.

This is not a strict no-overshoot financial ledger. Concurrent requests can pass the preflight check before either request commits usage. Strict enforcement would require an atomic, idempotent request ledger:

```text
reserve(request_id, estimated_cost)
  -> commit(request_id, actual_cost)
  -> release(request_id, unused_reservation)
```

with the invariant:

```text
committed_spend + active_reservations <= team_budget
```

Retries, fallbacks, duplicate callbacks, streaming cancellation, and final-cost adjustment must be covered before exposing such a mode.

## Management API

All Team endpoints use OmniRoute management authentication.

| Method                     | Endpoint                  | Purpose                             |
| -------------------------- | ------------------------- | ----------------------------------- |
| `GET` / `POST`             | `/api/teams`              | List or create Teams                |
| `GET` / `PATCH` / `DELETE` | `/api/teams/{id}`         | Inspect, update, or archive a Team  |
| `GET` / `PUT` / `DELETE`   | `/api/teams/{id}/members` | List, assign, or unassign API keys  |
| `GET`                      | `/api/teams/{id}/usage`   | Team summary and per-key drill-down |

`DELETE /api/teams/{id}` archives rather than physically deleting the Team. It closes active key assignments while preserving usage attribution.

## Deliberate phase-1 limits

Phase 1 does not add Organization, User, Role, Membership, delegated Team Admin, SSO, or SCIM objects. The existing global Management Admin manages Team configuration. It also does not reuse Quota Share as a strict USD ledger: Quota Share remains suited to provider capacity and fairness, while Team financial enforcement remains explicitly soft until reservation accounting exists.
