// Rejeição de admissão de chat precisa deixar rastro.
//
// Produção 2026-08-09: o operador via `chat_admission_busy` continuamente no cliente
// enquanto `call_logs/` e o log da aplicação mostravam ZERO ocorrências — a rejeição
// acontece em route.ts antes do logger de chamadas e não emitia log próprio. Três
// análises de log concluíram "3 erros em 2 dias" por causa disso.
//
// Estes testes fixam: toda rejeição POR CAPACIDADE emite um log estruturado e carrega
// os metadados que a rota precisa para persistir. Os 413 (limite rígido) NÃO entram
// nesse canal — são erro terminal, já visíveis ao cliente, e não medem capacidade.
import test from "node:test";
import assert from "node:assert/strict";

const {
  admitChatRequest,
  admitChatStructure,
  ChatAdmissionController,
} = await import("../../src/shared/middleware/chatBodyAdmission.ts");

function captureWarnings<T>(run: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = original;
  }
}

async function captureWarningsAsync<T>(
  run: () => Promise<T>
): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = original;
  }
}

function bigRequest(bytes: number, declareLength: boolean): Request {
  const body = "x".repeat(bytes);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (declareLength) headers["content-length"] = String(bytes);
  return new Request("http://x/v1/chat/completions", { method: "POST", headers, body });
}

test("rejeição por Content-Length declarado emite log estruturado com gatilho e ocupação", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const { result, warnings } = await captureWarningsAsync(() =>
    admitChatRequest(bigRequest(2048, true), {
      controller,
      largeBodyBytes: 512,
      hardMaxBytes: 1024 * 1024,
    })
  );

  assert.equal(result.admit, false);
  assert.equal(warnings.length, 1, "uma rejeição, um log");
  assert.match(warnings[0], /chat_admission_busy/);
  assert.match(warnings[0], /content-length/, "o gatilho precisa dizer COMO foi classificada");
  assert.match(warnings[0], /activeHeavy=1/, "quantas ocupavam a capacidade no momento");
  occupied.release();
});

test("rejeição descoberta durante a leitura (chunked) reporta gatilho próprio", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const { result, warnings } = await captureWarningsAsync(() =>
    admitChatRequest(bigRequest(2048, false), {
      controller,
      largeBodyBytes: 512,
      hardMaxBytes: 1024 * 1024,
    })
  );

  assert.equal(result.admit, false);
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /streamed-bytes/,
    "sem Content-Length o corpo já foi bufferizado — o gatilho precisa distinguir isso"
  );
  occupied.release();
});

test("rejeição estrutural nomeia a regra que classificou como pesada", () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const { result, warnings } = captureWarnings(() =>
    admitChatStructure({ messages: [], tools: [{ type: "function" }, { type: "function" }] }, null, {
      controller,
      maxMessages: 10,
      heavyMessages: 10,
      heavyTools: 2,
      heavyTokens: 10_000,
    })
  );

  assert.equal(result.admit, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /chat_admission_busy/);
  assert.match(warnings[0], /tools/, "o gatilho foi a contagem de ferramentas, não bytes");
  occupied.release();
});

test("a rejeição carrega metadados para a rota persistir em call_logs", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const result = await admitChatRequest(bigRequest(2048, true), {
    controller,
    largeBodyBytes: 512,
    hardMaxBytes: 1024 * 1024,
  });

  assert.equal(result.admit, false);
  if (result.admit) return;
  assert.ok(result.rejection, "sem metadados a rota teria que re-derivar o motivo");
  assert.equal(result.rejection.code, "chat_admission_busy");
  assert.equal(result.rejection.status, 503);
  assert.equal(result.rejection.trigger, "content-length");
  assert.equal(result.rejection.activeHeavy, 1);
  occupied.release();
});

test("admissão bem-sucedida não emite log de rejeição", async () => {
  const controller = new ChatAdmissionController(1);

  const { result, warnings } = await captureWarningsAsync(() =>
    admitChatRequest(bigRequest(2048, true), {
      controller,
      largeBodyBytes: 512,
      hardMaxBytes: 1024 * 1024,
    })
  );

  assert.equal(result.admit, true);
  assert.deepEqual(warnings, []);
  if (result.admit) result.lease?.release();
});

test("413 de limite rígido não entra no canal de capacidade", async () => {
  const controller = new ChatAdmissionController(1);

  const { result, warnings } = await captureWarningsAsync(() =>
    admitChatRequest(bigRequest(4096, true), {
      controller,
      largeBodyBytes: 512,
      hardMaxBytes: 1024,
    })
  );

  assert.equal(result.admit, false);
  if (result.admit) return;
  assert.equal(result.response.status, 413);
  assert.deepEqual(warnings, [], "limite rígido é erro terminal, não medida de capacidade");
});

test("413 de histórico não entra no canal de capacidade", () => {
  const controller = new ChatAdmissionController(1);

  const { result, warnings } = captureWarnings(() =>
    admitChatStructure({ messages: new Array(20).fill({ role: "user", content: "x" }) }, null, {
      controller,
      maxMessages: 10,
      heavyMessages: 5,
      heavyTools: 5,
      heavyTokens: 10_000,
    })
  );

  assert.equal(result.admit, false);
  if (result.admit) return;
  assert.equal(result.response.status, 413);
  assert.deepEqual(warnings, []);
});
