import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_QUEUE_TIMEOUT_ERROR_TYPE,
  isSelfInflictedFailure,
} from "../../open-sse/handlers/chatCore/cooldownClassification.ts";

/**
 * A local queue drop is not a provider failure.
 *
 * `rateLimitManager` rejects a request that waited longer than
 * `resilienceSettings.requestQueue.maxWaitMs` — it never reaches the upstream.
 * It surfaced as a bare 503 and so travelled the same path as a real provider
 * 5xx: connection cooldown, model lockout, and the #1731v2 skip that takes the
 * sibling targets down with it.
 *
 * Measured in production 2026-08-08 over 40 min of Cursor usage: 9 queue drops
 * produced 4 cooldowns on healthy connections, 4 model lockouts and one
 * `All models failed` whose fallback target was never tried.
 */

const OTHER = "openai-compatible-chat-f71d6553";

test("a local queue drop skips the connection cooldown", () => {
  assert.equal(isSelfInflictedFailure(503, LOCAL_QUEUE_TIMEOUT_ERROR_TYPE, OTHER), true);
});

test("a genuine provider 503 still cools the connection down", () => {
  // The whole point of the cooldown: an upstream that is actually failing.
  assert.equal(isSelfInflictedFailure(503, undefined, OTHER), false);
  assert.equal(isSelfInflictedFailure(503, "server_error", OTHER), false);
});

test("our own deadline timeout stays protected", () => {
  assert.equal(isSelfInflictedFailure(504, "upstream_timeout", OTHER), true);
});

test("antigravity keeps its own pre-response-timeout policy", () => {
  assert.equal(isSelfInflictedFailure(504, "upstream_timeout", "antigravity"), false);
});

test("the queue drop has no antigravity exception — the queue is ours for everyone", () => {
  assert.equal(isSelfInflictedFailure(503, LOCAL_QUEUE_TIMEOUT_ERROR_TYPE, "antigravity"), true);
});

test("the two rules do not bleed into each other", () => {
  // REVISADO 2026-08-09. A versão original desta asserção exigia que um 504
  // etiquetado como queue drop fosse `false`, com a justificativa de que é "uma
  // forma que nunca emitimos". Essa exatidão foi a armadilha: no dia seguinte
  // descobrimos o irmão `RATE_LIMIT_QUEUE_WEDGED`, que É emitido, com a mesma
  // natureza e um status diferente (502) — e a regra amarrada ao par status+tipo
  // não o cobriu, custando lockout e cooldown numa conexão saudável.
  //
  // A etiqueta de fila é escrita só pelo OmniRoute, num ponto único. Onde ela
  // aparecer, o significado é o mesmo: a requisição não chegou ao provider. Não
  // existe status que torne correto punir a conexão nesse caso, então o tipo
  // sozinho decide.
  assert.equal(isSelfInflictedFailure(504, LOCAL_QUEUE_TIMEOUT_ERROR_TYPE, OTHER), true);
  // `upstream_timeout` mantém o par: não é etiqueta exclusivamente nossa (a
  // antigravity também a emite), então o 504 continua delimitando a regra.
  assert.equal(isSelfInflictedFailure(503, "upstream_timeout", OTHER), false);
});

test("unrelated failures are untouched", () => {
  assert.equal(isSelfInflictedFailure(500, undefined, OTHER), false);
  assert.equal(isSelfInflictedFailure(429, undefined, OTHER), false);
  assert.equal(isSelfInflictedFailure(401, undefined, OTHER), false);
  assert.equal(isSelfInflictedFailure(200, undefined, OTHER), false);
});

// --- o portão de verdade -----------------------------------------------------
//
// `chat.ts:1787` decide pelo `shouldSkipConnDisable`; o predicado acima é só uma
// das cláusulas. Estes testes provam o comportamento no ponto onde o cooldown é
// (ou não é) disparado.

test("shouldSkipConnDisable spares the connection on a queue drop", async () => {
  const { shouldSkipConnDisable } = await import(
    "../../open-sse/services/combo/comboPredicates.ts"
  );
  const dropped = {
    status: 503,
    errorType: LOCAL_QUEUE_TIMEOUT_ERROR_TYPE,
    errorCode: "RATE_LIMIT_QUEUE_TIMEOUT",
  };
  assert.equal(
    shouldSkipConnDisable(dropped, false, false, OTHER),
    true,
    "markAccountUnavailable must not run for a request that never left the process"
  );
});

test("shouldSkipConnDisable still disables the connection on a real provider 503", async () => {
  const { shouldSkipConnDisable } = await import(
    "../../open-sse/services/combo/comboPredicates.ts"
  );
  assert.equal(
    shouldSkipConnDisable({ status: 503, errorType: undefined }, false, false, OTHER),
    false,
    "a genuinely failing upstream must still cool down"
  );
});
