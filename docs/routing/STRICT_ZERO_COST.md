---
title: "STRICT_ZERO_COST"
version: 3.8.50
lastUpdated: 2026-08-20
---

# STRICT_ZERO_COST

> Opt-in, off by default (`settings.freeAccessPolicy !== "strict"` leaves every `auto/*`
> candidate pool byte-identical). A stricter sibling of `hidePaidModels`
> (`open-sse/services/autoCombo/paidModelFilter.ts`, #6512) for operators who need a hard
> guarantee against ANY incremental monetary spend, not just "documented as free".

## Why this exists, and why `hidePaidModels` alone isn't enough

`hidePaidModels` answers "is this model classified free in `FREE_MODEL_BUDGETS` right now?" —
a point-in-time catalog fact, checked via `isFreeModel()`/`providerHasFreeModels()`
(`src/shared/utils/freeModels.ts`). It says nothing about two real risks:

1. A `recurring-*`/`one-time-initial` free tier's allowance can be **exhausted** — the catalog
   still lists the model as free, but the account behind it has no headroom left.
2. Exceeding a free tier is not always a hard stop. Some providers document explicitly that no
   payment method can ever be attached ("no credit card required"); others don't say, and a
   handful bill automatically past the free allowance.

`hidePaidModels` cannot distinguish these — it was never meant to. STRICT_ZERO_COST adds exactly
these two checks, evaluated per candidate, **before** category/tier ranking and **before**
dispatch — never after a request has already gone out.

## Candidate classification

For every candidate in the pool (`open-sse/services/autoCombo/virtualFactory.ts::buildPreparedPool`,
right after `filterPaidOnlyCandidates`):

1. **Not in `FREE_MODEL_BUDGETS` at all** → excluded. This covers genuinely paid models and any
   provider/model OmniRoute hasn't classified yet — new candidates start excluded, not included.
2. **`freeType: "keyless"`** → passes immediately. No credential exists for a keyless candidate,
   so no request against it can ever be billed — no runtime check is needed or possible.
3. **Any other `freeType`** (`recurring-daily`, `recurring-monthly`, `recurring-credit`,
   `recurring-uncapped`, `one-time-initial`, and any future type this module doesn't
   special-case) → passes only if **all** of the following hold:
   - `hardStopGuaranteed: true` is set on the catalog entry (`FreeModelBudget.hardStopGuaranteed`,
     `open-sse/config/freeModelCatalog.ts`) — a **curated, hand-set fact** about the provider's
     own published terms (e.g. an explicit "no credit card required" claim), never derived from
     `freeType` or from a live API response. Unset (`undefined`) and `false` are both treated as
     "not guaranteed".
   - A usage adapter exists for the provider in `USAGE_FETCHER_PROVIDERS`
     (`open-sse/services/usage.ts`) — the same registry that already backs the quota dashboard and
     `getUsageForProvider()`. No adapter → excluded, permanently, until one is added.
   - The live, cached `FreeAccessState` for that (provider, connection) pair is `status: "SAFE"`,
     was checked within `settings.autoRefreshProviderQuotaInterval` (default 180s — the existing
     setting, not a new number), and reports `remainingFreeAllowance` above a small safety margin.
4. **`freeType: "discontinued"`** → always excluded.

`discovered automatically`: a provider/model shipped tomorrow with the right metadata (in the
catalog, with a usage adapter, `hardStopGuaranteed: true`) is usable the moment OmniRoute knows
about it — no code change, no whitelist entry, nothing to edit in this module. One removed from
the catalog disappears the same way. See
`tests/unit/autoCombo/strict-zero-cost-autodiscovery.test.ts` for the regression proof (via
injectable fixtures, not by mutating the real catalog).

## Quota caching (`open-sse/services/autoCombo/freeAccessQuota.ts`)

Reuses `getUsageForProvider()` — no second quota system. A short, in-memory,
process-lifetime cache sits in front of it (TTL equal to the default
`autoRefreshProviderQuotaInterval`) so a Telegram-scale request rate never triggers a live
billing-API call per candidate per request. Reads are synchronous: a cache miss returns
`undefined` (→ excluded, fail-closed) and kicks off a background refresh for the _next_ read —
nothing in the candidate-pool build path ever awaits a network call.

`invalidateFreeAccessState(provider, connectionId)` is called from
`src/sse/services/auth.ts::markAccountUnavailable()` the moment a connection fails for any
reason, so the very next pool build reads a clean cache miss instead of a stale `SAFE` entry —
no waiting out the TTL after a 402/403/quota-exhausted response.

## ToS guard (independent of economic safety)

`excludeTosAvoid` (default `false`) drops any candidate whose curated `tos` verdict
(`FreeModelBudget.tos`) is `"avoid"` — reuses the same field `hidePaidModels`'s sibling docs
(`docs/reference/FREE_TIERS.md`) already populate. Deliberately separate from
`freeAccessPolicy`: a candidate can be economically `SAFE` and still excluded here for
contractual reasons, or left in when this guard is off even with `freeAccessPolicy: "strict"` on.

## What passes today

Run `npx tsx scripts/ad-hoc/dry-run-strict-zero-cost.ts` against a live instance's
`GET /v1/auto-combo/{channel}/candidates` output for a real before/after. As of 2026-08-20, only
`freeType: "keyless"` candidates pass in practice — no currently-catalogued `recurring-*`
provider both has a usage adapter registered in `USAGE_FETCHER_PROVIDERS` **and**
`hardStopGuaranteed: true` declared. This is not a bug: it's the honest state of two
independently-curated metadata sets that happen not to overlap yet, not a limitation of the
filter itself.

## Enabling

```json
PUT /api/settings
{ "freeAccessPolicy": "strict", "excludeTosAvoid": false }
```

Both new settings default to their pre-feature values (`"off"` / `false`) — enabling neither
changes any existing `auto/*` routing behavior.
