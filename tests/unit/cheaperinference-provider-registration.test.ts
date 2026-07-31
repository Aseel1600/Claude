// Cheaper Inference (api.cheaperinference.com) — OSS-sponsor gateway provider.
// Locks the canonical catalog entry so the id/alias/brand cannot drift, and
// guards the two invariants the provider gates enforce (Zod shape + a registry
// entry that maps back to a canonical provider).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_PROVIDERS,
  getProviderByAlias,
  USAGE_SUPPORTED_PROVIDERS,
} from "@/shared/constants/providers";

test("cheaperinference is a canonical provider with the agreed id/alias/brand", () => {
  const provider = AI_PROVIDERS.cheaperinference as unknown as Record<string, unknown>;
  assert.ok(provider, "cheaperinference missing from AI_PROVIDERS");
  assert.equal(provider.id, "cheaperinference");
  assert.equal(provider.alias, "cinf");
  assert.equal(provider.name, "Cheaper Inference");
  // Brand green from the supplied logomark (stroke="#31f889").
  assert.equal(provider.color, "#31f889");
  assert.match(String(provider.website), /^https:\/\/cheaperinference\.com/);
});

test("cheaperinference resolves by alias", () => {
  // getProviderByAlias is the alias-aware lookup; getProviderById indexes by
  // catalog key only and would never resolve "cinf".
  const byAlias = getProviderByAlias("cinf") as unknown as Record<string, unknown> | null;
  assert.ok(byAlias, "alias cinf does not resolve");
  assert.equal(byAlias.id, "cheaperinference");
});

test("cheaperinference is NOT wired into any quota/usage surface", () => {
  // Operator decision 2026-07-31: no quota card. The provider exposes no
  // balance API (/v1/wallet and /v1/balance both 404), so a quota card would
  // have to invent a number. Guard the decision so a later sweep does not
  // silently add one.
  assert.ok(
    !USAGE_SUPPORTED_PROVIDERS.includes("cheaperinference"),
    "cheaperinference must not be in USAGE_SUPPORTED_PROVIDERS (no balance API upstream)"
  );
});
