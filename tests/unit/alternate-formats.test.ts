import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAlternateFormat } from "../../open-sse/config/providers/alternateFormats.ts";
import type { RegistryEntry } from "../../open-sse/config/providers/shared.ts";
import { getTargetFormat } from "../../open-sse/services/provider.ts";

const ENTRY: RegistryEntry = {
  id: "demo",
  format: "openai",
  executor: "default",
  authType: "apikey",
  authHeader: "bearer",
  baseUrl: "https://example.com/v1",
  models: [],
  alternateFormats: [
    {
      format: "claude",
      baseUrl: "https://example.com/anthropic/v1/messages",
      authHeader: "x-api-key",
      headers: { "Anthropic-Version": "2023-06-01" },
      label: "Anthropic-compatible",
    },
  ],
};

test("retorna a alternativa quando targetFormat da conexao casa", () => {
  const alt = resolveAlternateFormat(ENTRY, { targetFormat: "claude" });
  assert.equal(alt?.format, "claude");
  assert.equal(alt?.authHeader, "x-api-key");
});

test("retorna null quando targetFormat nao casa com nenhuma alternativa", () => {
  assert.equal(resolveAlternateFormat(ENTRY, { targetFormat: "gemini" }), null);
});

test("retorna null quando a conexao nao tem targetFormat", () => {
  assert.equal(resolveAlternateFormat(ENTRY, {}), null);
  assert.equal(resolveAlternateFormat(ENTRY, null), null);
  assert.equal(resolveAlternateFormat(ENTRY, undefined), null);
});

test("retorna null quando a entry nao declara alternativas", () => {
  assert.equal(resolveAlternateFormat({ ...ENTRY, alternateFormats: undefined }, { targetFormat: "claude" }), null);
  assert.equal(resolveAlternateFormat(null, { targetFormat: "claude" }), null);
});

test("ignora targetFormat que nao e string nao-vazia", () => {
  assert.equal(resolveAlternateFormat(ENTRY, { targetFormat: 42 }), null);
  assert.equal(resolveAlternateFormat(ENTRY, { targetFormat: "" }), null);
});

// Task 2: getTargetFormat honra o override da conexao.
test("getTargetFormat: sem override da conexao usa o formato padrao do registry", () => {
  assert.equal(getTargetFormat("xiaomi-mimo", null), "openai");
});

test("getTargetFormat: override da conexao troca o formato quando declarado", () => {
  assert.equal(getTargetFormat("xiaomi-mimo", { targetFormat: "claude" }), "claude");
});

test("getTargetFormat: override desconhecido cai no formato padrao", () => {
  assert.equal(getTargetFormat("xiaomi-mimo", { targetFormat: "gemini" }), "openai");
});
