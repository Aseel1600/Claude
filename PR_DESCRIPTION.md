## Summary

Implements the minimal opt-in producer for the Runstead attempt-receipt v1 contract on the protected ChatGPT Web lane.

Refs pedro-labsabs/Runstead#29

Base: `release/v3.8.50` @ `ee221d870c199bc1aa1f3b90303ff2bc7c74509b`

### What this PR does

A request that sends exactly `X-Runstead-Attempt-Receipts: v1` (plus a non-empty `X-Runstead-Client-Request-Id` and an explicit `X-OmniRoute-Connection` pin) is executed on a strict lane that produces exactly one `X-OmniRoute-Attempt-Receipts` response header carrying a finalized v1 `AttemptReceiptSet` with exactly one receipt (`sequence: 1`, `trigger: "initial"`, `upstream_reached: true`). Requests without the opt-in keep OmniRoute's normal behavior byte-for-byte.

### Where the physical attempt is registered

The receipt is born at the physical model-send boundary in `ChatGptWebExecutor.execute()` (`open-sse/executors/chatgpt-web.ts`): the single `tlsFetchChatGpt(conversationEndpoint, { method: "POST", ... })` call. `started_at` is stamped immediately before the POST; `completed_at` when that POST returns or throws an observable error. Session exchange, warmup, Sentinel, proof-of-work and polling never produce receipts, and execution that ends before the POST fabricates none.

### How strict mode neutralizes fallback / retry / rotation

The strict lane enforces its properties structurally on its own path (global settings are not relied on):

- routing gate in `src/sse/handlers/chat.ts`: combos, auto-routing, virtual combos, task-aware/web-search/reasoning reroutes, guardrail/hook model overrides and safety-net combo redirects fail closed before any model POST; the final routing model must equal the requested canonical model.
- `handleSingleModelChat`: resolved provider must be `chatgpt-web`; the selected connection must equal the pinned one (session-affinity pins/exclusion cannot swap it); cooldown replay and emergency fallback are disabled.
- `handleChatCore`: strict lane validation (provider/model/connection), semantic-cache/dedup/idempotency bypass, no 401/403 refresh-and-re-execute, no thinking-signature/T5/context-overflow recovery — a provider error returns immediately with the single receipt.
- executor pre-POST rejections: `stream: true`, `tools`, image-generation/edit intents and pinned-connection mismatch are rejected with a 4xx and no receipt.

Exactly one conversation POST per logical request: success -> 1, 401/403/429/5xx -> 1, transport throw -> 1, pre-POST failures -> 0.

### account_lane_hash v1

```
SHA-256( UTF-8("omniroute-connection-v1") || byte 0x00 || UTF-8(connection_id) )
```

lowercase hex, 64 chars, derived from the REAL connection that executed the POST (raw connection ids are never exposed). Runstead #30 derives the same value over the configured connection, so a mismatched connection cannot validate.

### Files changed

- `open-sse/services/runsteadAttemptReceipts.ts` (new) — header constants, opt-in parsing, lane-hash v1, receipt-set construction, outcome mapping, strict lane validation, single-header attachment.
- `open-sse/executors/chatgpt-web.ts` — strict pre-POST rejections and receipt lifecycle at the conversation POST boundary.
- `open-sse/executors/base.ts` — optional `attemptReceiptStrict` field on `ExecuteInput`.
- `open-sse/handlers/chatCore.ts` — strict lane validation, semantic-cache/dedup/idempotency bypass, refresh/fallback suppression, non-streaming response header forwarding (only `X-OmniRoute-Attempt-Receipts`).
- `src/sse/handlers/chat.ts` — opt-in parsing and fail-closed routing gate (combo/auto/reroute rejection, pin verification).
- `src/sse/handlers/chatHelpers.ts` — threads the strict context through `executeChatWithBreaker`.
- `docs/architecture/ATTEMPT_RECEIPTS.md` (new) + `docs/README.md` index entry.
- `tests/unit/runstead-attempt-receipts.test.ts` (new) — 22 tests: lane-hash vectors, opt-in parsing, outcome mapping, receipt-set shape, redaction, lane validation.
- `tests/unit/chatgpt-web-runstead-receipts.test.ts` (new) — 19 tests: success receipt, no-amplification (401/403/429/5xx/throw/timeout/abort all exactly one POST), connection pin fail-closed, text-only rejections, no-fabricated-receipt cases, redaction, non-opt-in unchanged behavior.

### Validation executed (branch)

- Prettier on all changed files — pass
- ESLint on changed files (official suppressions config) — pass
- `node --import tsx/esm --test tests/unit/runstead-attempt-receipts.test.ts` — 22/22 pass
- `node --import tsx/esm --test tests/unit/chatgpt-web-runstead-receipts.test.ts` — 19/19 pass
- `tests/unit/chatgpt-web.test.ts` — 85/85 pass (regression)
- `tests/unit/chatgpt-web-*.test.ts` — 83/83 pass (regression)
- `npm run typecheck:core` — pass
- `npm run test:unit` — results in the PR checklist below
- `npm run test:vitest` — 40 files / 362 tests pass
- `node scripts/check/check-file-size.mjs` — OK
- `node scripts/check/check-complexity.mjs` — OK
- `node scripts/check/check-cognitive-complexity.mjs` — OK
- `node scripts/check/check-test-discovery.mjs` — OK
- `npm run check:docs-all` — pass (fabricated-docs strict: no fabricated references)
- `npm run check:cycles` — OK
- `git diff --check` — clean

### Base-red inherited

`npm run check:docs-all` reports 64 pre-existing stale-version drift warnings in docs untouched by this PR (e.g. `docs/security/STEALTH_GUIDE.md`); the gate still exits 0. No quality-gate baselines were modified.

### Limitations (explicit)

- Text-only and non-streaming (`stream: true`, `tools`, image-gen/edit are rejected before any model POST).
- `chatgpt-web` only; no receipts for other providers, combos, streaming, persistence or polling.
- `X-OmniRoute-Attempt-Receipts` is the only header forwarded from the executor on the strict path.
