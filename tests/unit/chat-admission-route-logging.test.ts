// A rota precisa registrar a rejeição de admissão, não só devolvê-la.
//
// Produção 2026-08-09: `chat_admission_busy` chegava ao cliente continuamente com ZERO
// linhas em `call_logs`. A rejeição acontece em route.ts antes de `handleChat`, então
// nenhum logger downstream a vê. Reusa `recordRejectedRequestUsage`, o mesmo caminho
// que as rejeições de circuit-breaker/cooldown já usam.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-chat-admission-log-"));
process.env.DATA_DIR = TEST_DATA_DIR;
// O que este teste fixa é a persistência da rejeição, não a espera. A rota lê o orçamento
// do env no carregamento do módulo, então encurtá-lo aqui evita segurar o teste por 10s
// sem trocar o caminho exercitado — a fila continua sendo percorrida.
process.env.OMNIROUTE_CHAT_ADMISSION_MAX_WAIT_MS = "1";

const core = await import("../../src/lib/db/core.ts");
const chatRoute = await import("../../src/app/api/v1/chat/completions/route.ts");
const { defaultAdmissionController, CHAT_LARGE_BODY_BYTES } = await import(
  "../../src/shared/middleware/chatBodyAdmission.ts"
);
const { getCallLogs } = await import("../../src/lib/usage/callLogs.ts");

test.after(() => {
  core.resetDbInstance?.();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function oversizedChatRequest(): Request {
  // Um corpo acima do limiar de "grande" força a reserva de capacidade antes do parse.
  const filler = "y".repeat(CHAT_LARGE_BODY_BYTES + 1024);
  const body = JSON.stringify({
    model: "test-model",
    messages: [{ role: "user", content: filler }],
  });
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "content-length": String(body.length) },
    body,
  });
}

test("rejeição de admissão na rota vira linha em call_logs", async () => {
  const before = (await getCallLogs({ limit: 200 })).length;

  const occupied = defaultAdmissionController.tryAcquireHeavy();
  assert.ok(occupied, "o teste precisa da capacidade ocupada para provocar a rejeição");

  let response: Response;
  try {
    response = await chatRoute.POST(oversizedChatRequest());
  } finally {
    occupied.release();
  }

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "chat_admission_busy");

  // `recordRejectedRequestUsage` escreve best-effort, sem await, para não somar latência
  // ao caminho de erro — o mesmo contrato das rejeições de circuit-breaker. Então esperar
  // a linha aparecer faz parte do teste, não é contorno.
  let after = await getCallLogs({ limit: 200 });
  for (let i = 0; i < 40 && after.length === before; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    after = await getCallLogs({ limit: 200 });
  }

  assert.equal(
    after.length,
    before + 1,
    "a rejeição precisa aparecer em call_logs — era exatamente o que faltava em produção"
  );

  const row = after[0];
  assert.equal(row.status, 503);
  assert.match(String(row.error), /chat_admission_busy/);
  assert.match(String(row.error), /trigger=content-length/, "o gatilho precisa sobreviver até o log");
  assert.equal(defaultAdmissionController.activeHeavy, 0, "nenhuma vaga pode vazar na rejeição");
});
