# External Integrations

**Analysis Date:** 2026-08-14

## APIs & External Services

**LLM Providers (339 total):**
- OpenAI (ChatGPT, GPT-4, o1) - SDK via HTTP, API key auth
  - Routes: `src/app/api/v1/chat/completions`, `src/app/api/v1/embeddings`
  - Executor: `open-sse/executors/openai.ts`
  - Translator: `open-sse/translator/openai.ts`
- Anthropic (Claude family) - HTTP protocol, API key auth
  - Executor: `open-sse/executors/anthropic.ts`
  - OAuth support: `src/lib/oauth/providers/claude.ts`
- Google Gemini - HTTP protocol, API key + OAuth
  - Executor: `open-sse/executors/gemini.ts`
  - OAuth: `src/lib/oauth/providers/ghe-copilot.ts`
- AWS Bedrock - @aws-sdk/client-bedrock-runtime 3.1073.0
  - Region-aware HTTP dispatch
  - Config: `open-sse/config/bedrock.ts`
  - Executor: `open-sse/executors/bedrock.ts`
- Grok (xAI) - OAuth + API key flows
  - OAuth: `src/lib/oauth/providers/grok-cli-oauth.ts`, `src/lib/oauth/providers/grok-cli.ts`
- 334+ more providers (Hugging Face, LLaMA, Mistral, etc.)
  - Registry: `open-sse/config/providerRegistry.ts`
  - Provider definitions: `src/shared/constants/providers.ts`

**OAuth Providers (20+):**
- GitHub - `src/lib/oauth/providers/github.ts`
- GitLab Duo - `src/lib/oauth/providers/gitlab-duo.ts`
- GitHub Enterprise Copilot - `src/lib/oauth/providers/ghe-copilot.ts`
- Claude (Anthropic) - `src/lib/oauth/providers/claude.ts`
- Codex (Cursor IDE) - `src/lib/oauth/providers/codex.ts`
- Cline (VS Code) - `src/lib/oauth/providers/cline.ts`
- Cursor - `src/lib/oauth/providers/cursor.ts`
- Grok CLI OAuth - `src/lib/oauth/providers/grok-cli-oauth.ts`
- Grok CLI - `src/lib/oauth/providers/grok-cli.ts`
- Zed - `src/lib/oauth/providers/zed.ts`, `src/lib/oauth/providers/zed-hosted.ts`
- Zed Keychain Reader - `src/lib/zed-oauth/keychain-reader.ts` (system keychain via Keytar 7.9.0)
- Raycast - `src/lib/oauth/providers/raycast.ts`
- Kimo Coding - `src/lib/oauth/providers/kimi-coding.ts`
- Antigravity - `src/lib/oauth/providers/antigravity.ts`
- Codebuddy CN - `src/lib/oauth/providers/codebuddy-cn.ts`
- Devin Desktop - `src/lib/oauth/providers/devin-desktop.ts`
- Kilocode - `src/lib/oauth/providers/kilocode.ts`
- Trae - `src/lib/oauth/providers/trae.ts`
- Kiro - `src/lib/oauth/providers/kiro.ts`
- OpenFérence - `src/lib/oauth/providers/openference.ts`
- Qoder - `src/lib/oauth/providers/qoder.ts`
- AGY - `src/lib/oauth/providers/agy.ts`

**Tunneling & Networking:**
- Ngrok (@ngrok/ngrok 1.7.0) - Tunnel public URLs for webhooks/callbacks
  - Routes: `src/app/api/tunnels/ngrok/`
- Cloudflare Tunnels - Zero Trust network access
  - Config/auth: `src/app/api/settings/proxy/cloudflare-deploy/`

**WebSocket & Real-time:**
- ws 8.18.0 - WebSocket server/client
  - A2A protocol streaming: `src/lib/a2a/streaming.ts`
  - Live dashboard WS: `src/app/api/v1/streams/` routes
  - Chat completion SSE: `open-sse/handlers/chatCore.ts` (SSE streams)

**Code Editor Integrations:**
- Cursor IDE - Built-in Cursor support via `src/lib/oauth/providers/cursor.ts`
- Cline (VS Code extension) - OAuth flow via `src/lib/oauth/providers/cline.ts`
- Codex - Custom protocol integration
- Zed - Full OAuth + token management
- Raycast - Script command integration

**Cloud Agent Platforms:**
- Devin (cloud AI engineer) - `src/lib/cloudAgent/agents/devin.ts`
- Codex Cloud - `src/lib/cloudAgent/agents/codex-cloud.ts`
- Jules (research agent) - `src/lib/cloudAgent/agents/jules.ts`
  - Registry: `src/lib/cloudAgent/registry.ts`
  - Task execution: `src/lib/a2a/taskExecution.ts`

## Data Storage

**Databases:**
- SQLite 3
  - Primary storage: `~/.omniroute/storage.sqlite` (or `DATA_DIR/storage.sqlite`)
  - Driver adapters: `src/lib/db/adapters/` (better-sqlite3 or sql.js fallback)
  - 145+ migrations: `src/lib/db/migrations/`
  - WAL mode enabled for concurrency
  - FTS5 extension for full-text search (memory corpus, local corpus)
  - Encryption: AES-256-GCM via `src/lib/db/encryption.ts` (optional `STORAGE_ENCRYPTION_KEY`)
  - Domain modules: `src/lib/db/` (proxyLogs, apiKeys, webhooks, providers, circuitBreakers, featureFlags, etc.)

**Redis (Optional):**
- ioredis 5.10.1 (optional dependency)
  - Connection: `REDIS_URL` env var (e.g., `redis://localhost:6379`)
  - Purpose: Distributed rate limiting, session/auth cache, quota management
  - Fallback: In-memory store if `REDIS_URL` unset (single-instance deployments work out-of-box)
  - Local Redis container: `src/app/api/local/redis/` routes (Docker-based)
  - Store factory: `src/lib/quota/storeFactory.ts`

**Vector Database (Optional):**
- Qdrant - Semantic memory & vector search
  - Connection: `QDRANT_HOST`, `QDRANT_PORT`, `QDRANT_API_KEY` env vars
  - Collection: `QDRANT_COLLECTION` (default: "memories")
  - Config: `src/lib/memory/qdrant.ts`
  - Vector size: `QDRANT_VECTOR_SIZE` (default: 1536)
  - HNSW settings: `QDRANT_HNSW_EF_CONSTRUCT` (default: 128)
  - Health check: `checkQdrantHealth()`
  - Operations: upsert, delete, search semantic memory

**File Storage:**
- Local filesystem only (no S3/GCS integration)
  - Logs directory: `DATA_DIR/logs/`
  - Database backups: `DATA_DIR/db_backups/`
  - Data serialization: `src/lib/usage/callLogArtifacts.ts`
- Sharp 0.35.3 - Image processing (thumbnails, AVIF conversion)

**Caching:**
- SQLite FTS5 - Full-text search cache for memory retrieval
- In-memory: Lowdb 7.0.1 (JSON file store)
- Circuit breaker state: `domain_circuit_breakers` SQLite table
- Rate limiter: Redis (if configured) or in-memory LRU

## Authentication & Identity

**JWT-based (Custom):**
- Implementation: `src/lib/jwt.ts`, `jose 6.2.3`
- Issued on: First setup (admin), API key generation
- Stored: Secure HTTP-only cookies (dashboard), bearer tokens (API)
- Validation: Every route via `extractApiKey()` and `isValidApiKey()`
- Secret: `JWT_SECRET` env var (required, generated on setup)

**API Key Management:**
- Hash: bcryptjs 3.0.3 (Bcrypt hashing)
- Storage: `api_keys` SQLite table with encryption
- Secret key for HMAC: `API_KEY_SECRET` env var
- Validation: `src/sse/services/auth.ts::getProviderCredentials()`
- Policy enforcement: `src/server/authz/routeGuard.ts`

**OAuth (20+ providers):**
- Directory: `src/lib/oauth/providers/`
- Config: `src/lib/oauth/constants/oauth.ts`
- Flow: Authorization Code (standard OIDC/OAuth2)
- Storage: `provider_connections` SQLite table (encrypted credentials, refresh tokens)
- Keychain fallback: Zed keychain via `keytar 7.9.0` (macOS/Windows credential manager)

**Password-based (Admin setup):**
- Initial password: `INITIAL_PASSWORD` env var
- Hash: bcryptjs 3.0.3
- Change endpoint: `/api/v1/auth/change-password`

## Monitoring & Observability

**Logging:**
- Framework: Pino 10.3.1 (structured JSON logging)
- Output: `pino-pretty` for dev, raw JSON for production
- Level: Controlled by `APP_LOG_LEVEL` env var (default: info)
- Context: `src/shared/utils/logger.ts`
- Audit log: `mcp_audit` SQLite table (MCP tool invocations)

**Health Checks:**
- Endpoint: `src/app/api/monitoring/health/route.ts`
- Status: Provider circuit breakers, upstream availability, cache health
- Database health: `src/lib/db/healthCheck.ts`
- Qdrant health: `src/lib/memory/qdrant.ts::checkQdrantHealth()`
- Redis health: Connection test on demand

**Error Tracking:**
- None (no Sentry/DataDog integration)
- Error logging: Via Pino (structured, queryable in logs)
- Error sanitization: `src/open-sse/utils/error.ts::buildErrorBody()` (no stack traces in responses)

**Metrics:**
- Provider metrics: `src/app/api/provider-metrics/route.ts`
- Health matrix: `src/app/api/providers/health-matrix/route.ts`
- Coverage/usage: `src/lib/usage/` modules
- Circuit breaker state: Runtime status API

## CI/CD & Deployment

**Hosting Options:**
- Self-hosted (Node.js, Docker, systemd)
- Docker (multi-stage: base + runner-web with Playwright)
- Fly.io (Node.js buildpack, `fly.toml` config)
- Vercel (Next.js serverless)
- Electron desktop app (macOS, Windows, Linux)
- Cloudflare Workers (relay via proxy)
- Deno Deploy (relay via proxy)

**CI Pipeline:**
- GitHub Actions (.github/workflows/)
- Jobs: `lint`, `quality-gate`, `quality-extended`, `test-unit`, `test-vitest`, `test-ecosystem`, `test-e2e`
- Nightly: `nightly-release-green`, `nightly-mutation`, `nightly-resilience`, `nightly-llm-security`
- Publish: `npm-publish` (npm registry), `docker-publish` (Docker Hub, ghcr.io)
- Deploy: `deploy-vps.yml` (VPS 192.168.0.15 for live testing)

**Build Artifacts:**
- npm package: `omniroute` CLI + embedded server
- Docker image: Node.js 22 Alpine base + Playwright browser stack
- Electron: Native macOS .dmg, Windows .exe, Linux .AppImage
- Standalone: `dist/` directory with bundled assets

## Environment Configuration

**Required env vars (Production):**
- `JWT_SECRET` - Secret for JWT signing (openssl rand -base64 48)
- `API_KEY_SECRET` - Secret for API key hashing (openssl rand -hex 32)
- `INITIAL_PASSWORD` - Admin password on first setup (min 8 chars)
- `NODE_ENV` - "production" or "development"
- `PORT` - HTTP server port (default: 20128)

**Optional env vars (Performance/Features):**
- `REDIS_URL` - Redis connection string (redis://localhost:6379). If unset, in-memory fallback.
- `QUOTA_STORE_REDIS_URL` - Separate Redis URL for quota management
- `QDRANT_HOST` - Qdrant server hostname (e.g., localhost, qdrant.example.com)
- `QDRANT_PORT` - Qdrant port (default: 6333)
- `QDRANT_API_KEY` - Qdrant API key (if protected)
- `QDRANT_COLLECTION` - Vector collection name (default: "memories")
- `QDRANT_EMBEDDING_MODEL` - Embedding model selector (default via provider config)
- `QDRANT_VECTOR_SIZE` - Embedding dimension (default: 1536)
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID for Worker deployments
- `CLOUDFLARE_API_BASE` - Cloudflare API base URL (default: https://api.cloudflare.com/client/v4)
- `OMNIROUTE_REDIS_CONTAINER_NAME` - Docker container name for local Redis (default: omniroute-redis)
- `OMNIROUTE_REDIS_HOST_PORT` - Host port binding for local Redis (default: 6379)
- `OMNIROUTE_REDIS_IMAGE` - Docker image for Redis (default: docker.io/redis:7-alpine)
- `STORAGE_ENCRYPTION_KEY` - AES-256-GCM key for encrypting credentials at rest (hex-encoded)
- `APP_LOG_LEVEL` - Pino log level (trace, debug, info, warn, error, fatal)
- `REQUIRE_API_KEY` - Enforce API key for all requests (true/false, optional)
- `DISABLE_SQLITE_AUTO_BACKUP` - Disable automatic SQLite backups (set in test suite)
- `OMNIROUTE_NO_SUDO` - Disable sudo for MITM cert install in rootless environments

**Secrets location:**
- Credentials: Encrypted in SQLite `provider_connections` table (AES-256-GCM if `STORAGE_ENCRYPTION_KEY` set)
- Env-based: `.env` file (git-ignored, loaded via Node.js dotenv pattern or Next.js auto)
- Secure stores: macOS Keychain / Windows Credential Manager via `keytar 7.9.0` (Zed OAuth tokens)

## Webhooks & Callbacks

**Incoming Webhooks:**
- Directory: `src/app/api/v1/webhooks/`
- Types: `provider-status`, `usage-alert`, `circuit-breaker`, custom events
- Handlers: `src/lib/webhooks/integrations/` (Slack, Discord, Telegram, HTTP)
- Verification: HMAC-SHA256 signature validation
- Retry: Exponential backoff (configurable)
- Database: `webhooks` and `webhook_deliveries` SQLite tables

**Webhook Integrations:**
- Slack - Message notifications via webhook URL
  - Formatter: `src/lib/webhooks/integrations/slack.ts::buildSlackPayload()`
- Discord - Embed-based notifications
  - Formatter: `src/lib/webhooks/integrations/discord.ts::buildDiscordPayload()`
- Telegram - Chat notifications via bot token
  - Formatter: `src/lib/webhooks/integrations/telegram.ts`
- HTTP Custom - Generic POST to webhook URL (JSON payload)

**Outgoing Webhooks:**
- Events: Provider status changes, usage milestones, circuit breaker state, quota alerts
- Dispatcher: `src/lib/webhookDispatcher.ts::dispatchEvent()`
- Event types: `src/lib/webhooks/eventDescriptions.ts`

**MCP Protocol (Model Context Protocol):**
- SDK: @modelcontextprotocol/sdk 1.29.0
- Server: `open-sse/mcp-server/`
- 105 tools across 3 transports (stdio, SSE, Streamable HTTP)
- 31 scopes (base, memory, skill, agentSkill, pool, notion, obsidian, gamification, plugin, etc.)
- Audit: `mcp_audit` SQLite table

**A2A Protocol (Agent-to-Agent):**
- Format: JSON-RPC 2.0
- Transports: WebSocket, HTTP Server-Sent Events
- Implementation: `src/lib/a2a/` (taskExecution, streaming, skills)
- Skills: smart-routing, quota-management, provider-discovery, cost-analysis, health-report
- Agent Card: `.well-known/agent.json` endpoint

---

*Integration audit: 2026-08-14*
