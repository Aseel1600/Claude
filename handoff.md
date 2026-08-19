# Handoff: Cloudflare Workers AI Adapter Fixes for Probe Script

## Summary

Fixed three Cloudflare Workers AI adapter bugs discovered during production probing on oracle-vps. The `/ai/v1/chat/completions` endpoint requires `message.content` to be a plain string — Cloudflare rejects `null`, arrays, or objects. The fixes enable 4-gate probe to pass for `@cf/` models.

## Changes Made

### 1. `open-sse/executors/cloudflare-ai.ts` — null content handling

**Lines 84-106:** Extended `flattenContent()` to convert `null`/`undefined` → `""` for all message roles. Changed message mapping condition from `Array.isArray(msg.content)` to `"content" in msg` so null content is processed.

```typescript
// Before: only handled array content
msg && Array.isArray(msg.content) ? { ...msg, content: flattenContent(msg.content) } : msg;

// After: handles null/undefined/string/array uniformly
msg && "content" in msg ? { ...msg, content: flattenContent(msg.content) } : msg;
```

**Test added:** `tests/unit/executor-cloudflare-ai.test.ts` — verifies null content on assistant and tool messages becomes `""`.

### 2. `scripts/ad-hoc/probe-routes.mjs` — gate 4 message normalization

**Lines 332-351:** Normalized the echoed assistant message from gate 3 (which has `content: null` in OpenAI tool-call convention) to `content: ""` before including in gate 4 request. Also fixed `rejectUnauthorized: false` → `true` for TLS security.

### 3. Probe route list updated

**DEFAULT_ROUTES** now contains 33 curated routes from production DB:

- :free/-free models from active providers (command-code, nous-research, openrouter, etc.)
- Combo-referenced models from active providers (antigravity, codex, longcat, nvidia)

## Probe Results (Latest Run)

| Route                                               | Gate 1 | Gate 2 | Gate 3 | Gate 4 | Classification            |
| --------------------------------------------------- | ------ | ------ | ------ | ------ | ------------------------- |
| `cloudflare-ai/@cf/zai-org/glm-4.7-flash`           | ✅     | ✅     | ✅     | ✅     | **STRONG**                |
| `cloudflare-ai/@cf/google/gemma-4-26b-a4b-it`       | ✅     | ✅     | ✅     | ✅     | **STRONG**                |
| `cloudflare-ai/@cf/openai/gpt-oss-20b`              | ✅     | ✅     | ❌ 400 | —      | TOOL_CONTINUATION_FAILURE |
| `cloudflare-ai/@cf/ibm-granite/granite-4.0-h-micro` | ✅     | ✅     | ❌ 400 | —      | TOOL_CONTINUATION_FAILURE |
| `cloudflare-ai/@cf/nvidia/nemotron-3-120b-a12b`     | ❌ 502 | —      | —      | —      | UNRESOLVED                |

## Remaining Issues (Need Production Deploy)

**GPT-OSS 20B & Granite Micro fail at Gate 3 with 400:**

```
Type mismatch of '/messages/0/content', 'array' not in 'string'
Type mismatch of '/messages/1/content', 'string' not in 'null'
```

The Cloudflare executor fix (null content → "") is **not yet deployed to production**. Production runs Docker image `omniroute:canary-e13905c67-20260819` on oracle-vps. The container must be rebuilt with the new `cloudflare-ai.ts` code.

### Deploy Path

- **CI/CD:** `.github/workflows/deploy-vps.yml` triggers on `docker-publish.yml` completion
- **Manual:** `npm install -g omniroute@latest` then `pm2 restart` on VPS
- **VPS access:** Via `omniroute` MCP server (user has API key) or `deploy-vps-local` skill

## Next Steps

1. **Deploy Cloudflare fix to production** — rebuild Docker image and deploy to oracle-vps
2. **Re-run probe on 6 @cf/ routes** — should see GPT-OSS 20B and Granite pass Gate 3
3. **Verify Nemotron 3 120b** — 502 may be transient or model-specific
4. **Run full 33-route probe** — after Cloudflare fixes verify

## Files Modified

- `open-sse/executors/cloudflare-ai.ts` (+6 lines)
- `scripts/ad-hoc/probe-routes.mjs` (null normalization + TLS fix)
- `tests/unit/executor-cloudflare-ai.test.ts` (+16 lines test)
- `scripts/ad-hoc/routes-6-targeted.json` (6 @cf/ routes for targeted testing)

## Test Commands

```bash
# Unit tests for Cloudflare executor
node --import tsx/esm --test tests/unit/executor-cloudflare-ai.test.ts
node --import tsx/esm --test tests/unit/cloudflare-ai-image-parts-6390.test.ts

# Probe 6 targeted @cf/ routes
node scripts/ad-hoc/probe-routes.mjs --routes scripts/ad-hoc/routes-6-targeted.json

# Full 33-route probe
node scripts/ad-hoc/probe-routes.mjs
```

## Branch/Worktree

- Branch: `feat/probe-routes-script`
- Worktree: `.claude/worktrees/probe-routes/`
- Remote: `thinh0704hcm/OmniRoute` (fork — push to fork, PR to upstream)
