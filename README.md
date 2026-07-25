# OmniRoute Go

OpenAI-compatible AI provider gateway written in Go. Single binary, zero CGO, SQLite-backed.

Ported from the [TypeScript OmniRoute](https://github.com/diegosouzapw/OmniRoute) — same provider catalog and translation logic, stripped of the dashboard/MCP/A2A/compression layers to produce a lean proxy core.

## Quick Start

```bash
nix-shell --run 'go build -o omniroute ./cmd/omniroute/'
./omniroute
```

Server starts on `:3000`. API at `http://localhost:3000/v1`.

```bash
# List models
curl http://localhost:3000/v1

# Chat completion (requires upstream API key via env or header)
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

## Features

| Feature | Status |
|---------|--------|
| Chat completions (streaming + non-streaming) | Done |
| Embeddings | Done |
| Image generation | Done |
| Responses API format | Done |
| Provider registry (15 providers, 144 models) | Done |
| Request translation (OpenAI ↔ Claude, OpenAI ↔ Gemini) | Done |
| Streaming SSE proxy with keepalive | Done |
| SQLite persistence (17 tables, pure Go) | Done |
| API key auth (Bearer token + DB validation) | Done |
| Middleware (logging, CORS, body-limit, auth) | Done |
| Executor with retry + backoff + Retry-After | Done |
| Upstream error sanitization | Done |
| Connection pooling (shared http.Transport) | Done |
| Graceful shutdown | Done |
| Audio speech/transcription | Stub |
| Rate limiting | Pending |
| Combo routing engine | Pending |
| MCP/A2A protocols | Pending |
| Compression pipeline | Pending |

## Providers

15 providers registered with full model catalogs:

OpenAI, Anthropic, DeepSeek, Groq, Google Gemini, Mistral, Cohere, Together AI, Fireworks, Cerebras, NVIDIA, xAI, Hugging Face, OpenRouter, SambaNova

API keys are resolved in order:
1. `X-API-Key` header
2. `Authorization: Bearer <key>` header
3. Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)

## Architecture

```
cmd/omniroute/          Entry point, .env loading
internal/
  config/               Provider registry, routing strategies, constants
    providers/          15 provider registrations with model catalogs
  db/                   SQLite schema, migrations, CRUD modules
  executor              HTTP executor with retry/backoff
  middleware            Auth, CORS, logging, body-limit
  server/               HTTP handlers (chat, embeddings, images, responses)
  streaming/            SSE writer and stream proxy
  translator/           Request/response translation (hub-and-spoke via OpenAI)
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/healthz` | Health check (alias) |
| `GET` | `/v1` | List all registered models |
| `POST` | `/v1/chat/completions` | Chat completions (streaming + non-streaming) |
| `POST` | `/v1/embeddings` | Embeddings |
| `POST` | `/v1/images/generations` | Image generation |
| `POST` | `/v1/responses` | Responses API (converts to/from chat completions) |
| `POST` | `/v1/audio/speech` | Audio speech (stub) |
| `POST` | `/v1/audio/transcriptions` | Audio transcription (stub) |

## Configuration

Environment variables (`.env` or export):

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `REQUIRE_API_KEY` | Set to `true` to require API key auth |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `GROQ_API_KEY` | Groq API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `MISTRAL_API_KEY` | Mistral API key |
| `COHERE_API_KEY` | Cohere API key |
| `TOGETHER_API_KEY` | Together AI API key |
| `FIREWORKS_API_KEY` | Fireworks API key |
| `CEREBRAS_API_KEY` | Cerebras API key |
| `NVIDIA_API_KEY` | NVIDIA API key |
| `XAI_API_KEY` | xAI API key |
| `HUGGINGFACE_API_KEY` | Hugging Face API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `SAMBANOVA_API_KEY` | SambaNova API key |

## Build

Requires Go 1.23+ and GCC (for `modernc.org/sqlite`).

```bash
# With Nix
nix-shell --run 'go build -o omniroute ./cmd/omniroute/'

# Without Nix
go build -o omniroute ./cmd/omniroute/
```

Binary size: ~16 MB. Zero external runtime dependencies.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Go 1.23+ |
| Database | SQLite via `modernc.org/sqlite` (pure Go, no CGO) |
| HTTP | `net/http` (no external router) |
| Logging | `log/slog` |
| Nix | `shell.nix` with `go_latest` |

## License

MIT — see [LICENSE](LICENSE).
