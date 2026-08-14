# Technology Stack

<!-- refreshed: 2026-08-14 -->

**Analysis Date:** 2026-08-14

## Languages

**Primary:**
- TypeScript 6.0.3 - Core application logic, Next.js App Router, open-sse handlers
- JavaScript (ES Modules) - Build scripts, CLI utilities, Node.js runtime
- JSX/TSX - React component definitions in `src/app/(dashboard)` and shared UI components

**Secondary:**
- HTML5/CSS3 - Templated via React/Next.js
- SQL - SQLite migrations in `src/lib/db/migrations/`
- TOML - Configuration parsing with `smol-toml`

## Runtime

**Environment:**
- Node.js `>=22.22.2 <23 || >=24.0.0 <27` (mandatory, specified in `package.json::engines`)
- ES Module resolution (`"type": "module"` in `package.json`)
- Runtime features: async/await, Promise, native test runner (`node:test`)
- Optional: Bun 1.3.14 (dev-only for gate/generator scripts; not the published runtime)

**Package Manager:**
- npm (npm install, npm ci, npm run)
- Lockfile: `package-lock.json` (present)
- Workspaces: `open-sse/`, `packages/browser-pool` (npm workspaces in `package.json`)

## Frameworks

**Core:**
- Next.js 16.2.11 (App Router) - Main web framework, API routes under `src/app/api/`, Dashboard UI in `src/app/(dashboard)/`
- React 19.2.8 - UI component library
- React DOM 19.2.8 - React DOM rendering for Next.js SSR
- Express 5.2.1 - Lightweight server utilities (HTTP middleware)

**Styling & UI:**
- Tailwind CSS 4.3.0 - Utility-first CSS framework (configured in `next.config.mjs`)
- tailwind-merge 3.6.0 - Merge Tailwind class names with conflict resolution
- PostCSS 8.5.18 - CSS processing pipeline
- Material Symbols - Icon library reference (material-symbols 0.45.2)
- Lucide React 1.21.0 - Icon component library

**Documentation & Content:**
- Fumadocs Core 16.10.5 - Documentation framework
- Fumadocs UI 16.10.5 - Pre-built documentation UI components
- Fumadocs MDX 15.2.2 - MDX support for docs
- Mermaid 11.15.0 - Diagram rendering (ASCII/SVG)
- Marked 18.0.4 - Markdown parser
- Marked Terminal 7.3.0 - Terminal markdown rendering
- React Markdown 10.1.0 - React markdown renderer component

**Internationalization:**
- next-intl 4.12.0 - Multi-language support with i18n routing (`src/i18n/`)

**Themes:**
- next-themes 0.4.6 - Dark/light mode toggle

**State Management & Data:**
- Zustand 5.0.13 - Lightweight state management (`src/shared/hooks/`)
- React Query - Via Zustand (not directly visible in dependencies)
- Lowdb 7.0.1 - JSON file database for local storage

**Logging & Diagnostics:**
- Pino 10.3.1 - Fast structured JSON logging
- Pino Abstract Transport 3.0.0 - Pino transport abstraction layer
- Pino Pretty 13.1.3 - Pretty-printed Pino output for development
- Ora 9.4.1 - CLI spinner/loading indicator
- WTFNode 0.10.1 - Debug tool for finding event listener leaks

**Analytics & Visualization:**
- Recharts 3.8.1 - React charting library for dashboard metrics
- XYFlow React 12.11.1 - React node/edge graph visualization

**UI/Dialog Components:**
- ink 7.0.3 - React for terminal UIs (CLI interface)
- ink-spinner 5.0.0 - Terminal spinner
- ink-text-input 6.0.0 - Terminal text input
- Monaco Editor 0.56.0 - Code editor component (VS Code editor)
- @monaco-editor/react 4.7.0 - React wrapper for Monaco Editor

**Data Processing & Formatting:**
- DOMPurify 3.4.13 - XSS prevention (HTML sanitization)
- csv-stringify 6.7.0 - CSV format generation
- turndown 7.2.0 - HTML to Markdown converter
- turndown-plugin-gfm 1.0.2 - GitHub Flavored Markdown extension for Turndown
- js-yaml 5.2.2 - YAML parsing and serialization
- jsonc-parser 3.3.1 - JSON with comments parser
- Parse5 8.0.1 - HTML parser (DOM-compatible)

**Compression & Performance:**
- fflate 0.8.3 - Fast deflate compression
- xxhash-wasm 1.1.0 - Fast non-crypto hashing
- Yazl 3.3.1 - ZIP file creation

## Testing

**Framework:**
- Node.js native test runner (`node --test`) - Unit tests in `tests/unit/`
- Vitest 4.1.7 - Component and specialized testing (MCP, autoCombo, cache) (`npm run test:vitest`)
- @vitejs/plugin-react 6.0.5 - React support for Vitest

**Browser/E2E:**
- Playwright 1.62.0 - Browser automation and E2E testing
- @playwright/test 1.62.1 - Playwright testing framework
- playwright-ctrf-json-reporter 0.0.29 - Test result reporting

**Coverage & Quality:**
- c8 12.0.0 - Code coverage measurement (60% statements/lines/functions/branches floor)
- @testing-library/react 16.3.2 - React component testing utilities
- @testing-library/jest-dom 7.0.0 - Custom Jest matchers for DOM testing
- fast-check 4.8.0 - Property-based testing
- @axe-core/playwright 4.11.3 - Accessibility testing (WCAG/a11y)

**Mutation Testing:**
- @stryker-mutator/core 9.6.1 - Mutation testing framework
- @stryker-mutator/tap-runner 9.6.1 - TAP runner for Stryker

**Mocking & Test Utilities:**
- jsdom 30.0.1 - DOM implementation for Node.js tests

## Key Dependencies

**Critical (Production):**
- @modelcontextprotocol/sdk 1.29.0 - MCP server framework (105 tools across 3 transports)
- better-sqlite3 13.0.2 (optional) - Synchronous SQLite driver (blocks required for `npm install`)
- ioredis 5.10.1 - Redis client (optional, for rate limiting and quota caching)
- @aws-sdk/client-bedrock-runtime 3.1073.0 - AWS Bedrock API client
- undici 8.10.0 - HTTP client (replaces fetch in Node.js 18-)
- ws 8.18.0 - WebSocket server/client (A2A protocol streaming, Live WS dashboard)
- axios 1.16.1 - HTTP client with retries

**Infrastructure & Auth:**
- jose 6.2.3 - JWT handling (bearer token auth)
- bcryptjs 3.0.3 - Password hashing
- keytar 7.9.0 (optional) - System keychain access (Zed OAuth credential import)
- selfsigned 5.5.0 - Self-signed certificate generation (MITM proxy certs)
- @ngrok/ngrok 1.7.0 - Ngrok tunneling client

**Network & Proxy:**
- http-proxy-middleware 4.0.0 - HTTP proxy middleware
- https-proxy-agent 9.0.0 - HTTPS agent with proxy support
- fetch-socks 1.3.3 - SOCKS proxy support for fetch
- socks 2.8.7 - SOCKS5 client

**CLI & Terminal UI:**
- commander 15.0.0 - Command-line argument parsing
- update-notifier 7.3.1 - Notify users of package updates
- open 11.0.0 - Open URLs/files in default applications
- cron-parser 5.6.2 - Cron expression parsing

**ML/AI Integration:**
- @huggingface/transformers 4.2.0 - Transformer models (optional)
- onnxruntime-node 1.24.3 - ONNX runtime for inference
- js-tiktoken 1.0.20 (optional) - Token counting for OpenAI models
- @atjsh/llmlingua-2 2.0.3 (optional) - Prompt compression

**Utilities:**
- uuid 14.0.0 - UUID generation
- clsx 2.1.1 - Conditional className utility
- sharp 0.35.3 - Image processing (thumbnails, AVIF conversion)
- dompurify 3.4.13 - XSS prevention (HTML sanitization)
- bottleneck 2.19.5 - Rate limiting (queue/throttle)
- sql.js 1.14.1 - SQL.js database adapter (browser/Bun fallback)

## Configuration

**TypeScript:**
- `tsconfig.json` - Main TypeScript configuration (target: ES2022, module: esnext)
- `tsconfig.typecheck-core.json` - Core type-checking scope
- `tsconfig.typecheck-noimplicit-core.json` - Strict type-checking (no implicit any)
- Path aliases: `@/*` → `src/`, `@omniroute/open-sse` → `open-sse/`, `@omniroute/open-sse/*` → `open-sse/*`

**Next.js:**
- `next.config.mjs` - App configuration (CSP headers, MDX support, i18n plugin, CORS, query timeout)
- `next-env.d.ts` - Auto-generated Next.js types

**Build Tools:**
- `eslint.config.mjs` - ESLint configuration (ES2022, Node.js CommonJS modules)
- `.prettierrc` - Prettier formatter config (2-space, semicolons, 100-char width, trailing commas)
- `postcss.config.mjs` - PostCSS pipeline (Tailwind, Autoprefixer)
- `vitest.config.ts` - Vitest config (jsdom, React plugin, FTS5 setup)
- `vitest.mcp.config.ts` - Vitest MCP-specific config
- `playwright.config.ts` - Playwright E2E config

**Database:**
- `src/lib/db/migrations/` - 145+ idempotent SQLite migration files
- SQLite WAL mode enabled by default
- FTS5 (full-text search) extension for memory/corpus tables

**Environment:**
- `.env.example` (forbidden to read, but referenced in docs)
- Key vars: `PORT`, `JWT_SECRET`, `API_KEY_SECRET`, `INITIAL_PASSWORD`, `REQUIRE_API_KEY`, `APP_LOG_LEVEL`, `REDIS_URL`, `QDRANT_*`, `CLOUDFLARE_*`, `NODE_ENV`
- Data directory: `DATA_DIR` env or `~/.omniroute/` default

## Platform Requirements

**Development:**
- Node.js 22.22.2+ or 24.0.0+
- npm 9+ (for workspaces)
- SQLite3 development headers (for better-sqlite3 build)
- Python 3.8+ (optional, for some build scripts)
- Playwright dependencies (Chromium, Firefox, WebKit)

**Production:**
- Node.js 22.22.2+ or 24.0.0+
- SQLite3 (bundled; better-sqlite3 prebuilt binary or sql.js fallback)
- Redis server (optional, for distributed rate limiting; in-memory fallback if missing)
- Qdrant server (optional, for semantic memory; disabled if not configured)
- 512 MB+ RAM minimum (1 GB+ recommended)
- Disk space: ~200 MB base + variable for SQLite data (`~/.omniroute/`)

**Deployment Targets:**
- Docker (multi-stage: base, runner-web with Playwright)
- Fly.io (Node.js buildpack, custom `fly.toml`)
- Vercel (Next.js serverless)
- Self-hosted Linux/macOS (systemd, Docker, VM)
- Cloudflare Workers (via relay proxy)
- Deno Deploy (via relay proxy)
- Electron (desktop app in `electron/` subdirectory)

---

*Stack analysis: 2026-08-14*
