---
title: "Cursor API keys and the Cursor CLI passthrough"
version: 3.8.50
lastUpdated: 2026-08-19
---

# Cursor API keys and the Cursor CLI passthrough

Two ways to put Cursor behind OmniRoute without an IDE session:

1. **API-key connection**: paste a Cursor user API key (`crsr_…`, generated at
   `https://cursor.com/dashboard/api`) on the Cursor provider card. Any
   OmniRoute client then reaches Cursor models through `/v1/chat/completions`
   (`cursor/<model>` or `cu/<model>`), with the usual quota, fallback and
   logging layers.
2. **Cursor CLI passthrough**: point the Cursor CLI (`agent`) at OmniRoute so
   every RPC the CLI makes is authenticated with an OmniRoute API key, forwarded
   to Cursor with the connection's credential, and recorded in the Logs page.

## Why the key is exchanged

`api2.cursor.sh` rejects a raw `crsr_…` key as a Bearer token (401). The Cursor
CLI first POSTs the key to `/auth/exchange_user_api_key` and receives a session
JWT that expires after one hour; the returned `refreshToken` carries the same
`exp`, so refreshing means re-exchanging the key.
`open-sse/services/cursorApiKeyAuth.ts` does that exchange, caches one session
token per key, re-exchanges five minutes before expiry and drops the cached
token when Cursor answers 401. The registry entry stays `authType: "oauth"` so
the OAuth resilience profile keeps applying to the provider
(`open-sse/config/providers/registry/cursor/index.ts`).

## API-key connection

Dashboard: Providers → Cursor → **Manual API key** (the card is dual-auth, see
`DUAL_AUTH_PROVIDER_IDS` in `src/shared/constants/providers.ts`).

REST:

```bash
curl -sS -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -d '{"provider":"cursor","name":"cursor-api-key","apiKey":"crsr_…","priority":1}'
```

Then:

```bash
curl -sS http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer <omniroute-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"cursor/auto","messages":[{"role":"user","content":"say PONG"}]}'
```

Notes:

- `POST /api/providers/{id}/refresh-cursor` only applies to OAuth connections;
  API-key connections answer 400 there because there is no IDE session to
  renew.
- Model discovery for Cursor still shells out to `cursor-agent --list-models`
  (`src/lib/providerModels/cursorAgent.ts`). Without the CLI on the host the
  listing falls back to the static registry, which is enough for routing.

## Cursor CLI passthrough

Route: `src/app/api/cursor-cli/[...path]/route.ts` →
`open-sse/handlers/cursorCliProxy.ts`. The prefix `/api/cursor-cli/` is
registered in `src/shared/constants/publicApiRoutes.ts` because the handler
enforces its own authentication:

| Path                                                                                                                         | Auth expected from the CLI   | What OmniRoute does                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/exchange_user_api_key`                                                                                           | `Bearer <OmniRoute API key>` | Validates the key, mints a 1h HS256 JWT (signed with `JWT_SECRET`) and returns it                                                                                |
| every other path (`/aiserver.v1.*`, `/agent.v1.AgentService/RunSSE`, `/aiserver.v1.BidiService/BidiAppend`, `/v1/traces`, …) | `Bearer <that JWT>`          | Verifies issuer/audience/expiry, picks an active Cursor connection, swaps the Authorization header for the Cursor credential and streams the upstream reply back |

The CLI decodes `exp` from whatever token it receives, so handing it an opaque
token makes it re-exchange before almost every request; the minted JWT avoids
that. A 401 from OmniRoute makes the CLI exchange again.

### Setup

1. Create an OmniRoute API key (Dashboard → API keys) and a Cursor connection
   (API key or OAuth).
2. Tell the CLI to use HTTP/1.1 for the agent stream. In
   `~/.cursor/cli-config.json`:

   ```json
   { "network": { "useHttp1ForAgent": true } }
   ```

   Without this the CLI opens the agent turn over HTTP/2 to a separately
   configured agent host and only the control-plane RPCs go through the
   endpoint.

3. Run the CLI against OmniRoute:

   ```bash
   export CURSOR_API_ENDPOINT=http://localhost:20128/api/cursor-cli
   export CURSOR_API_KEY=<omniroute-api-key>
   agent -p --trust "Reply with exactly OK"
   ```

Every hop lands in Logs as provider `cursor`, request type `cursor-cli`, path
`/api/cursor-cli/<rpc>`, attributed to the OmniRoute API key and the Cursor
connection that served it.

### Failure modes

| Situation                                        | Response to the CLI                           |
| ------------------------------------------------ | --------------------------------------------- |
| Unknown OmniRoute key and `REQUIRE_API_KEY=true` | 401 `unauthenticated` on exchange             |
| `REQUIRE_API_KEY=false`                          | anonymous session (mirrors `/v1/*` behaviour) |
| Expired / foreign / tampered session JWT         | 401, the CLI re-exchanges                     |
| OmniRoute API key revoked after exchange         | 401 on the next RPC                           |
| No active Cursor connection                      | 503 `unavailable`                             |
| Cursor rejects the connection's key              | 401 `unauthenticated`, cached session dropped |
| Upstream unreachable                             | 502 `unavailable` (sanitized message)         |
| `JWT_SECRET` unset                               | 503 on exchange                               |
