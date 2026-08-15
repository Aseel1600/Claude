---
title: "Runstead attempt receipts v1 (strict ChatGPT Web lane)"
status: active
lastUpdated: 2026-08-15
---

# Runstead attempt receipts v1 — strict ChatGPT Web lane

The Runstead client (pedro-labsabs/Runstead, issue #29) requires an
authoritative, single-attempt receipt for every model-send it triggers through
the protected ChatGPT Web lane. OmniRoute produces it **only when the request
opts in**, and only on the lane where the exact provider, model and connection
can be proven.

The wire format is authoritative in Runstead:
`internal/provider/attempt_receipts.go` (schema v1 + outcome vocabulary) and
`internal/provider/omniroute/client_transport.go` (response header handling).
OmniRoute does not define a second format.

## Opt-in request headers

The strict mode activates **only** when the request sends exactly:

| Header                         | Value         | Meaning                          |
| ------------------------------ | ------------- | -------------------------------- |
| `X-Runstead-Attempt-Receipts`  | `v1`          | Opt-in to receipt-v1 strict mode |
| `X-Runstead-Client-Request-Id` | non-empty id  | Correlates the receipt set       |
| `X-OmniRoute-Connection`       | connection id | Explicit connection pin          |

Any other value (or absence) of `X-Runstead-Attempt-Receipts` keeps OmniRoute's
normal behavior unchanged. On the strict lane, a missing client request id, a
missing pin, a non-`chatgpt-web` model, `stream: true`, or any `tools` array
fails closed with a 4xx **before any model POST** and carries no receipt.

## Response header

A strict request whose physical model POST started receives exactly one
`X-OmniRoute-Attempt-Receipts` header containing a finalized v1
`AttemptReceiptSet` JSON: `schema_version: 1`, `finalized: true`, the echoed
`client_request_id`, and exactly one receipt with `sequence: 1`,
`trigger: "initial"`, `upstream_reached: true`, a fresh `attempt_id`, the
canonical provider-prefixed `model`, the `account_lane_hash` of the connection
really used, `started_at`/`completed_at` stamped around that POST, and one of
the Runstead v1 outcome values.

Only this single header is forwarded from the executor boundary to the client
response. No other executor or upstream headers pass through on the strict
path.

## Physical boundary

The receipt is born at the physical model-send in
`open-sse/executors/chatgpt-web.ts`: the single
`tlsFetchChatGpt(conversationEndpoint, { method: "POST", ... })` call, where
`conversationEndpoint` is the ChatGPT `backend-api/f/conversation` URL.
`started_at` is stamped immediately before that POST and `completed_at` when it
returns or throws an observable error. Session exchange, warmup, Sentinel,
proof-of-work and polling never produce receipts. If execution ends before the
POST, no receipt is fabricated (Runstead accounts conservatively for a missing
receipt).

## Outcome mapping

Only the Runstead v1 outcome vocabulary is used, mapped from what is safely
observable at the POST boundary:

- 2xx → `success`
- 401 → `authentication_expired`
- 403 → `http_403`
- 429 → `rate_or_capacity`
- 5xx → `upstream_server_failure`
- other 4xx → `http_error`
- throw around the POST: `TlsClientHangError`/`TimeoutError` → `timeout`,
  abort → `cancelled`, other transport failures → `transport_error`

Model text is never converted into a transport outcome. A pre-POST
`TlsClientUnavailableError` (the native TLS binary failed to load) produces no
receipt.

## Strict-mode guarantees

In strict mode the request structurally cannot escape through OmniRoute's
normal mechanisms:

- exactly one provider (`chatgpt-web`), one canonical model, one pinned
  connection; the connection that actually executes is verified to be the
  pinned one (session-affinity pins, exclusion logic and credential selection
  cannot swap it);
- combos, auto-routing, virtual combos, task-aware reroutes, reasoning
  reroutes, guardrail/hook model overrides and safety-net combo redirects fail
  closed before any model POST;
- cooldown replay, emergency fallback, global fallback, T5 intra-family
  fallback, context-overflow fallback, stream recovery, 401/403
  refresh-and-re-execute, model resend, account rotation and in-flight dedup
  join are disabled on the strict path;
- `stream: true`, `tools`, and detected image-generation/edit intents are
  rejected before the POST;
- settings such as `OMNIROUTE_EMERGENCY_FALLBACK=false` are not relied on; the
  strict lane enforces the property on its own path.

## Lane hash v1

`account_lane_hash` is derived from the REAL connection id that executed the
POST (raw connection ids are never exposed):

```
SHA-256( UTF-8("omniroute-connection-v1") || byte 0x00 || UTF-8(connection_id) )
```

represented as 64 lowercase hexadecimal characters. Runstead #30 derives the
same value over the configured connection, so a receipt produced on any other
connection cannot validate.

## Redaction

Receipts never contain cookies, session tokens, access tokens, authorization
headers, raw connection ids, account ids, prompts, messages, response bodies,
SSE bodies, upstream headers or conversation content.

## Non-opt-in behavior

Requests without `X-Runstead-Attempt-Receipts: v1` never activate the strict
mode and never receive the receipt header; their behavior is unchanged.

## Implementation

- `open-sse/services/runsteadAttemptReceipts.ts` — header constants, opt-in
  parsing, lane-hash v1, receipt-set construction, outcome mapping, strict lane
  validation, header attachment.
- `open-sse/executors/chatgpt-web.ts` — strict pre-POST rejections and the
  receipt lifecycle at the conversation POST boundary.
- `open-sse/handlers/chatCore.ts` — strict lane validation, semantic-cache /
  dedup / idempotency bypass, refresh/fallback suppression, and forwarding of
  the single receipt header on the non-streaming response paths.
- `src/sse/handlers/chat.ts` — opt-in parsing and the fail-closed routing gate
  (combo/auto-routing/reroute rejection, pin verification).

## Scope

Text-only, non-streaming, `chatgpt-web`, connection-pinned requests only.
There is no receipt support for combos, streaming, other providers, receipt
persistence or receipt polling.
