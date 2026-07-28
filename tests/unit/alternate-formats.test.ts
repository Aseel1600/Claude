import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAlternateFormat } from "../../open-sse/config/providers/alternateFormats.ts";
import type { RegistryEntry } from "../../open-sse/config/providers/shared.ts";
import { getTargetFormat } from "../../open-sse/services/provider.ts";
import { DefaultExecutor } from "../../open-sse/executors/default.ts";

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

// Task 3: resolucao de base URL honra a alternativa.
//
// Reproduz a precedencia implementada em BaseExecutor.resolveBaseUrl. Nao
// instanciamos o executor real aqui porque getRegistryEntry() le do registry
// estatico de providers (chaveado por provider id) e nenhuma entry real
// declara alternateFormats ainda (isso e a Task 5) — nao ha como injetar uma
// entry fake no registry sem sair do escopo desta task. O contrato de
// precedencia (manual > alternativa > default) e o mesmo aplicado no
// producao; tests/unit/refactor-resolveBaseUrl.test.ts ja cobre o caminho
// real (instanciando BaseExecutor) para os casos sem alternativa, e
// permanece verde apos a mudanca desta task.
function precedence(psd: unknown, entry: unknown, configBaseUrl: string) {
  const psdBaseUrl = (psd as { baseUrl?: unknown } | null)?.baseUrl;
  if (typeof psdBaseUrl === "string" && psdBaseUrl) return psdBaseUrl;
  const alt = resolveAlternateFormat(entry as never, psd);
  if (alt?.baseUrl) return alt.baseUrl;
  return configBaseUrl;
}

const ENTRY_WITH_ALT = {
  alternateFormats: [
    {
      format: "claude",
      baseUrl: "https://alt.example.com/anthropic/v1/messages",
      label: "Anthropic",
    },
  ],
} as never;

test("resolveBaseUrl: baseUrl manual da conexao vence a alternativa", () => {
  const url = precedence(
    { baseUrl: "https://manual.example.com/v1", targetFormat: "claude" },
    ENTRY_WITH_ALT,
    "https://default.example.com/v1"
  );
  assert.equal(url, "https://manual.example.com/v1");
});

test("resolveBaseUrl: alternativa vence o baseUrl padrao", () => {
  const url = precedence({ targetFormat: "claude" }, ENTRY_WITH_ALT, "https://default.example.com/v1");
  assert.equal(url, "https://alt.example.com/anthropic/v1/messages");
});

test("resolveBaseUrl: sem override usa o baseUrl padrao", () => {
  const url = precedence({}, ENTRY_WITH_ALT, "https://default.example.com/v1");
  assert.equal(url, "https://default.example.com/v1");
});

// Task 4: auth header e headers extras honram a alternativa.
//
// Mesma limitacao da Task 3: nenhuma entry real do registry declara
// alternateFormats ainda, entao reproduzimos a escolha de authHeader
// implementada em DefaultExecutor.buildHeaders (default.ts) sem instanciar o
// executor inteiro. O teste de regressao abaixo (via DefaultExecutor real)
// cobre o caminho sem alternativa para garantir que a nova chamada a
// resolveAlternateFormat nao alterou o comportamento por-default existente.
function pickAuthHeader(entry: unknown, psd: unknown) {
  const alt = resolveAlternateFormat(entry as never, psd);
  return alt?.authHeader || (entry as { authHeader?: string } | null)?.authHeader || "bearer";
}

const ENTRY_AUTH = {
  authHeader: "bearer",
  alternateFormats: [
    {
      format: "claude",
      baseUrl: "https://alt.example.com/anthropic/v1/messages",
      authHeader: "x-api-key",
      headers: { "Anthropic-Version": "2023-06-01" },
      label: "Anthropic",
    },
  ],
} as never;

test("authHeader: formato alternativo troca bearer por x-api-key", () => {
  assert.equal(pickAuthHeader(ENTRY_AUTH, { targetFormat: "claude" }), "x-api-key");
});

test("authHeader: sem override mantem o header da entry", () => {
  assert.equal(pickAuthHeader(ENTRY_AUTH, {}), "bearer");
});

test("alternativa carrega headers extras do protocolo", () => {
  const alt = resolveAlternateFormat(ENTRY_AUTH, { targetFormat: "claude" });
  assert.equal(alt?.headers?.["Anthropic-Version"], "2023-06-01");
});

// Regression via producao real: sem alternateFormats declarados no registry
// (xiaomi-mimo ainda nao os tem — Task 5), buildHeaders continua usando o
// authHeader "bearer" da entry mesmo com um targetFormat na conexao, provando
// que a nova chamada a resolveAlternateFormat nao regrediu o caminho default.
test("DefaultExecutor.buildHeaders: sem alternativa declarada, mantem o authHeader padrao", () => {
  const executor = new DefaultExecutor("xiaomi-mimo");
  const headers = executor.buildHeaders(
    {
      apiKey: "sk-test",
      providerSpecificData: { targetFormat: "claude" },
    } as never,
    true
  ) as Record<string, string>;
  assert.equal(headers["Authorization"], "Bearer sk-test");
  assert.equal(headers["x-api-key"], undefined);
});
