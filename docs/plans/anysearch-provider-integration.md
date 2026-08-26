# AnySearch provider integration blueprint

Branch: `feat/anysearch-search-provider` (planning). Template: xquik #11370 (commit a0ceccc, merged in release/v3.8.51). Posture: fallbackOnly (decided 2026-08-26; rationale in Q1 below).

## 1. Service ground truth (official docs, Patchright-rendered, cross-checked with 1mcp gateway MCP schema)

- Base URL: `https://api.anysearch.com` (REST) + `POST /mcp` (MCP, JSON-RPC 2.0).
- `POST /v1/search` - params: `query` (required), `max_results` (1-10, default 10), `tag` (`{domain}.{sub_domain}` vertical routing), `zone` (cn/intl), `language`, `params` (structured vertical fields), `format` (json/markdown).
- `GET /v1/sub-domains?domain=...` - capability catalog, does NOT count against quota.
- `POST /v1/extract` - fetch/extract `{url, title, content}`; strict JSON body, 16 KiB cap.
- `POST /v1/auth/email/register` - single-call registration, returns one-time plaintext key `as_sk_...`.
- Auth: optional `Authorization: Bearer <as_sk_...>`; anonymous degrades to per-IP limits consuming the daily free quota; invalid key returns 401/403 with NO silent anonymous fallback.
- Free tier: 1000 requests/day, 20 QPS per key. Paid tier: unpriced (Coming Soon).
- Response envelope: server-generated UUID v4 `request_id` (mirrored in `X-Request-ID`); success `code: 0` / `message: "success"`; errors `code: -1` + stable `error_code`.

## 2. Touch set (xquik-template anatomy, ~10 layers)

| Layer                 | File                                                                                                                                                                                                     | Change                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Registry entry        | `open-sse/config/searchRegistry.ts`                                                                                                                                                                      | add `anysearch-search` entry (draft below) + aliases `anysearch`, `anysearch_search`                                                      |
| Executor              | `open-sse/handlers/search/anysearchSearch.ts`                                                                                                                                                            | `ANYSEARCH_SEARCH_PROVIDER_ID`, `buildAnysearchSearchRequest`, `normalizeAnysearchSearchResponse`                                         |
| Dispatch maps         | `open-sse/handlers/search.ts`                                                                                                                                                                            | register builder in request-builder map (~line 719 region) and normalizer in response-normalizer map (~line 1296 region), mirroring xquik |
| UI catalog            | `src/shared/constants/providers/search.ts`                                                                                                                                                               | `anysearch-search` metadata entry (`serviceKinds: ["webSearch", "webFetch"]`)                                                             |
| Credential validation | `src/lib/providers/validation/searchProviders.ts`                                                                                                                                                        | `SEARCH_VALIDATOR_CONFIGS["anysearch-search"]`                                                                                            |
| Execution             | `src/lib/search/executeWebSearch.ts`                                                                                                                                                                     | only if dispatch requires explicit import (verify against xquik diff)                                                                     |
| MCP                   | `open-sse/mcp-server/schemas/tools.ts`, `server.ts`, `essentialTools.test.ts`                                                                                                                            | provider enumeration entries                                                                                                              |
| API schema            | `src/shared/validation/schemas/apiV1.ts`, `docs/openapi.yaml`                                                                                                                                            | provider enum values                                                                                                                      |
| Docs                  | `docs/reference/PROVIDER_REFERENCE.md`, `docs/frameworks/MCP-SERVER.md`, `llm.txt`, `docs/i18n/*/llm.txt`, `changelog.d/features/<n>-anysearch-search-provider.md`                                       | consistency copies                                                                                                                        |
| Tests + gates         | `tests/unit/anysearch-search-provider.test.ts`, `search-registry.test.ts`, `search-route.test.ts`, `tests/integration/search-providers-catalog.test.ts`, `tests/snapshots/executors/dispatch-rules.json` | mirror xquik suite; `bun run check:provider-consistency` must pass                                                                        |

## 3. Drafts

Registry entry:

```ts
// Free public web search for AI agents. fallbackOnly: cost-0 must
// not override configured paid providers in automatic selection.
"anysearch-search": {
  id: "anysearch-search",
  name: "AnySearch",
  baseUrl: "https://api.anysearch.com/v1/search",
  method: "POST",
  authType: "apikey",
  authHeader: "bearer",
  costPerQuery: 0,
  freeMonthlyQuota: 30000, // official free tier is 1000/day, expressed monthly
  searchTypes: ["web"],
  defaultMaxResults: 5,
  maxMaxResults: 10, // upstream hard cap (max_results 1-10)
  timeoutMs: 10_000,
  cacheTTLMs: 5 * 60 * 1000,
  fallbackOnly: true,
},
```

Executor contract (mirror xquikSearch.ts):

```ts
export const ANYSEARCH_SEARCH_PROVIDER_ID = "anysearch-search";
// build: { query, max_results } JSON body; Authorization: Bearer <key> only when a key is present (upstream auth is optional).
// normalize: envelope { code, message, data } -> SearchResult[] { title, url, snippet, date? };
//   code !== 0 -> provider failure path (formatSearchProviderFailure);
//   401/403 -> credential-invalid, never silently downgrade to anonymous (upstream behavior).
```

Validator draft:

```ts
"anysearch-search": (apiKey) => ({
  url: "https://api.anysearch.com/v1/search",
  init: {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: "test", max_results: 1 }),
  },
}),
```

## 4. Open questions (grill queue - one at a time)

1. Q1 routing posture: fallbackOnly vs full cost participation vs anonymous default. Recommended fallbackOnly - DECIDED by user 2026-08-26. Cost-0 must never dominate automatic cost routing; explicit selection and failover return are unaffected.
2. Q2 scope: DECIDED by user 2026-08-26 - `webFetch` via `POST /v1/extract` is IN scope for v1. `serviceKinds: ["webSearch", "webFetch"]`, aligned with tavily/exa dual-capability mental model.
3. Q3 quota display: DECIDED by user 2026-08-26 - `freeMonthlyQuota: 0` (xquik-style conservative display). The real allowance (1000 req/day, daily reset) is carried in the UI catalog `authHint` copy. Rationale: quota display must match reset semantics; converting a daily cap to a monthly-equivalent (30000) is a false promise the UI can't honor. Recorded in upstream issue diegosouzapw/OmniRoute#11637.
4. Q4 searchTypes: `["web"]` only - no public evidence of a news class; confirm against live API.
5. Q5 verticals: `tag` / `get_sub_domains` / `batch_search` - recommended out of scope v1 (no IR for vertical params today).
6. Q6 response shape: exact result item field names must be probed against the live API before writing the normalizer (docs render was truncated mid-page).

## 6. Implementation log (2026-08-26)

- Implemented on this branch: registry entry + aliases, anysearchSearch.ts executor, search.ts wiring (import/builders/normalizers), executeWebSearch + apiV1 alias canonicalization, UI constants (serviceKinds webSearch+webFetch), SEARCH_VALIDATOR_CONFIGS probe, anysearch-fetch.ts executor + webFetch.ts dispatch case + WEB_FETCH_PROVIDERS, MCP fetch enum + web_search description, dispatch-rules snapshot entry, PROVIDER_REFERENCE row, openapi description, SEARCH_TOOLS_STUDIO counts, searchTools/codeExport/lobeProviderIcons edge files, AGENTS/README/llm.txt+i18n counts 353->354, changelog.d entry. REVERTED 2026-08-26: AnySearch is a search provider, not a canonical LLM provider — count stays 353 (git checkout origin/release/v3.8.51 restore + migrations count sync to 160 in commits e78eb0f86+02cc3e5cf).
- Post-audit fix (2026-08-26): nested `"anysearch-search"` inside `firecrawl:` in `src/shared/constants/providers/search.ts` — moved to top level; stray `"anysearch-search",` outside array in `tests/unit/search-registry.test.ts` — moved inside array.
- Tests: new tests/unit/anysearch-search-provider.test.ts (8 cases) + tests/unit/executor-anysearch-fetch.test.ts (2 cases); search-registry (count 18->19 + assertions), search-route array, catalog integration counts 22->24 (19 search + 5 fetch).
- Deliberate exclusions: FETCH_BACKEND_TO_PROVIDER / FetchInterceptionBackend (chat interception backends stay firecrawl|jina|tavily); ANONYMOUS_CAPABLE_WEB_FETCH_PROVIDERS (routing stays key-gated; executor still calls keyless when reached); QUOTA_STATUS_PROVIDERS (upstream signals quota via 429/code:-1, not 402/403).

## 5. References

- xquik template: commit a0ceccc, PR #11370 (in-tree at release/v3.8.51).
- AnySearch official docs: https://anysearch.com/docs, https://anysearch.com/pricing; MCP catalog mcpservers.org/servers/anysearch-ai/anysearch-mcp-server; skill repo github.com/anysearch-ai/anysearch-skill.
- Precedent feature request (other router): github.com/decolua/9router issue #1274.
- Industry mental model: LiteLLM search docs (registry + unified search() + Perplexity-spec IR), open-webui web search (27 built-in providers, search_web/fetch_url dual tools), Dify tool plugin YAML pattern; cost-fallback ladder: self-hosted -> free quota -> paid.
