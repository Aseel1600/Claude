// Um 413 nao deve esfriar a conexao.
//
// Producao 2026-08-10: `[VB]-/mimo-v2.5` rejeita corpos acima de ~256 KB com
// "request entity too large". Nos tratavamos isso como falha transitoria da conexao —
// 12 x `Account ... unavailable (413), trying fallback` com cooldown de 3s, dentro de
// 101 falhas visiveis ao cliente. Esfriar nao conserta: o corpo tem 329 KB agora e vai
// ter 329 KB no retry. A conexao acabou de responder, dizendo que o payload nao cabe.
//
// A base ja tinha o conceito (`isInputBoundRequestFailure`, #8375: "determinado apenas
// pelo conteudo da requisicao, nao pelo estado do provider/conta"); so nao cobria a
// forma HTTP dele.
import test from "node:test";
import assert from "node:assert/strict";

const { shouldSkipConnDisable, isPayloadTooLargeFailure } = await import(
  "../../open-sse/services/combo/comboPredicates.ts"
);

const OUTRO = "openai-compatible-chat";

function resultado(status: number, extra: Record<string, unknown> = {}) {
  return { status, errorCode: null, errorType: null, error: null, ...extra };
}

test("413 e reconhecido como falha determinada pela entrada", () => {
  assert.equal(isPayloadTooLargeFailure(413), true);
  assert.equal(isPayloadTooLargeFailure(503), false);
  assert.equal(isPayloadTooLargeFailure(429), false);
});

test("413 pula o cooldown da conexao", () => {
  assert.equal(
    shouldSkipConnDisable(resultado(413), false, false, OUTRO),
    true,
    "a conexao acabou de responder — ela esta saudavel, o corpo e que nao cabe"
  );
});

test("413 pula o cooldown mesmo com texto de erro do provider", () => {
  const r = resultado(413, {
    error: "[413]: request entity too large and no fallback instance available",
  });
  assert.equal(shouldSkipConnDisable(r, false, false, OUTRO), true);
});

test("503 genuino continua esfriando a conexao", () => {
  assert.equal(
    shouldSkipConnDisable(resultado(503), false, false, OUTRO),
    false,
    "provider fora do ar e estado da conexao — cooldown continua correto"
  );
});

test("429 continua esfriando a conexao", () => {
  assert.equal(shouldSkipConnDisable(resultado(429), false, false, OUTRO), false);
});

test("502 continua esfriando a conexao", () => {
  assert.equal(shouldSkipConnDisable(resultado(502), false, false, OUTRO), false);
});

test("os casos ja cobertos seguem intactos", () => {
  // 499: cliente desistiu
  assert.equal(shouldSkipConnDisable(resultado(499), false, false, OUTRO), true);
  // plugin_block: politica nossa, nao falha do provider
  assert.equal(
    shouldSkipConnDisable(resultado(500, { errorType: "plugin_block" }), false, false, OUTRO),
    true
  );
  // 401 com chaves extras para rotacionar
  assert.equal(shouldSkipConnDisable(resultado(401), true, true, OUTRO), true);
  // context_length_exceeded: mesma familia do 413, ja coberto por codigo
  assert.equal(
    shouldSkipConnDisable(
      resultado(400, { errorCode: "context_length_exceeded" }),
      false,
      false,
      OUTRO
    ),
    true
  );
  // falha autoinfligida: fila local
  assert.equal(
    shouldSkipConnDisable(
      resultado(503, { errorType: "local_queue_timeout" }),
      false,
      false,
      OUTRO
    ),
    true
  );
});
