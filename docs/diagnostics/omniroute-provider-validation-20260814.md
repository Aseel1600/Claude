# OmniRoute provider validation report

## Final status

`C — CREDENTIAL_PROBLEM`

The runtime was healthy, but the three claimed manual provider registrations
were not present in the active data directory used by the server. No provider
request was sent without a configured connection, and no credential value was
read or exposed.

Timestamp: 2026-08-14T08:34:45-03:00

Starting HEAD: `0ad6dc59c118c779acc2a390edeb84851150bb9c`

## Runtime

- Data directory: `C:\Users\in9midia\.omniroute`.
- Startup: `npm run dev` with process-only Governor controls.
- Health: HTTP 200, `status=healthy`, version 3.8.50.
- Fresh runtime: PASS from the preceding recovery; runtime remained
  functional in this validation.
- Server was stopped after health and connection validation; no OmniRoute
  process remained.
- Ports 20128, 20131, and 20132 had no listener after stop. A transient
  transient TCP wait-state socket was not a listener.

## Governor

Launch controls were:

- Mode: `simulate`.
- Active: `false`.
- Canary: `0`.
- Telemetry: enabled with sample rate 1.

No active route mutation or canary rollout occurred.

## Credential validation

The active `provider_connections` table returned zero rows. Health also reported
`activeConnections=0`, zero open/half-open breakers, and zero model lockouts.
The fresh `server.env` contained the storage-encryption setting only; no
OpenRouter, NVIDIA, or Gemini provider secret name was present.

The user-reported manual registrations are therefore not observable in the
explicit active data directory. This report does not infer whether they were
entered into another runtime, another data directory, or were not persisted.

### OpenRouter

- Connection: MISSING.
- Credential: MISSING in active runtime.
- Discovery: BLOCKED — no connection.
- Normalization: NOT RUN.
- Sync: NOT RUN.
- Chat eligibility: NOT RUN.
- Auto-Combo candidate: NOT RUN.
- Native smoke: `0/0`, BLOCKED — USER CREDENTIALS REQUIRED.

### NVIDIA

- Connection: MISSING.
- Credential: MISSING in active runtime.
- Discovery: BLOCKED — no connection.
- Normalization: NOT RUN.
- Sync: NOT RUN.
- Chat eligibility: NOT RUN.
- Auto-Combo candidate: NOT RUN.
- Native smoke: `0/0`, BLOCKED — USER CREDENTIALS REQUIRED.

### Gemini

- Connection: MISSING.
- Credential: MISSING in active runtime.
- Discovery: BLOCKED — no connection.
- Normalization: NOT RUN.
- Sync: NOT RUN.
- Chat eligibility: NOT RUN.
- Auto-Combo candidate: NOT RUN.
- Native smokes: `0/5`, BLOCKED — USER CREDENTIALS REQUIRED.

No 401, 429, timeout, malformed stream, or provider error classification can
be claimed because no upstream request was made.

## Auto-Combo

- OpenRouter present: NO.
- NVIDIA present: NO.
- Gemini present: NO.
- Fresh credentialed candidate count: 0.
- Cross-connection isolation: NOT RUN in this empty runtime.
- Live authoritative catalog: NOT RUN in this empty runtime.
- Deduplication: NOT RUN in this empty runtime.

The previously published 53/53 focused baseline remains valid for the code, but
it is not a substitute for provider validation with configured connections.

## Auto/chat diagnostics

Status: BLOCKED — USER CREDENTIALS REQUIRED.

No 3–5 diagnostic requests were run because the explicit active runtime had no
provider connections. Consequently there are no sanitized attempt records,
fallback depths, native/Governor choice comparisons, or health mutations to
report.

## Gates

- 5/5 auto/chat: BLOCKED — provider connections missing.
- 10/10 auto/chat: BLOCKED — 5/5 prerequisite and credentials missing.
- Benchmark baseline: `0/20`, NOT RUN.
- Benchmark simulate: `0/20`, NOT RUN.
- Benchmark complete: NO.

## Tests and checks

- Fresh runtime health: PASS, HTTP 200.
- Previous focused Auto-Combo/Governor/stream/cleanup/compression baseline:
  PASS, 53/53.
- Previous `npm run typecheck:core`: PASS.
- Previous `git diff --check`: PASS.
- No production code changed in this validation; no new code regression suite
  was required.

## Changes

No production code, tests, configuration, encryption key, or runtime database
was changed. This execution adds only this sanitized validation report.

## Remaining blocker

The three provider connections are absent from
`C:\Users\in9midia\.omniroute\storage.sqlite` despite the reported manual
registration. The exact next action is to add OpenRouter, NVIDIA, and Gemini
again through the official OmniRoute provider-connection flow while the server
uses this explicit data directory, then verify only provider ID, connection ID,
active status, and sanitized error class.

Do not restore the stale archive, alter `STORAGE_ENCRYPTION_KEY`, hardcode keys,
or edit `.env`.

## Security and Git

- API keys printed: NO.
- Encryption key printed: NO.
- Authorization headers/tokens/cookies printed: NO.
- Runtime archive or database staged: NO.
- Governor active/canary rollout: NO.
- Computer shutdown/restart: NOT EXECUTED.
