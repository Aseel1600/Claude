// Capacidade ocupada deve fazer a requisição ESPERAR, não ser rejeitada na hora.
//
// O código rejeitava por decisão explícita ("Queueing is intentionally separate:
// unavailable capacity is a retryable 503"). Em produção isso jogava o problema no
// cliente: o Copilot recebia 503 e retentava sozinho, visivelmente, o tempo todo.
//
// A espera é MEDIDA — carimbada na entrada da fila e comparada ao conceder a vaga.
// Delegar a medição a um mecanismo que mede outra coisa foi o bug do `expiration` do
// Bottleneck (spec 2026-08-09): um botão que dizia limitar fila limitava execução.
import test from "node:test";
import assert from "node:assert/strict";

const { ChatAdmissionController, admitChatRequest, admitChatStructure } = await import(
  "../../src/shared/middleware/chatBodyAdmission.ts"
);

function bigRequest(bytes: number): Request {
  const body = "x".repeat(bytes);
  return new Request("http://x/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(bytes) },
    body,
  });
}

test("a segunda aquisição espera e é atendida quando a primeira libera", async () => {
  const controller = new ChatAdmissionController(1);
  const first = controller.tryAcquireHeavy();
  assert.ok(first);

  const pending = controller.acquireHeavy({ maxWaitMs: 2000 });
  await new Promise((resolve) => setTimeout(resolve, 60));

  first.release();
  const acquired = await pending;

  assert.ok(acquired.lease, "hoje isto volta null na hora — o cliente é que retenta");
  assert.ok(acquired.waitedMs >= 50, `esperou de verdade (${acquired.waitedMs}ms)`);
  acquired.lease.release();
  assert.equal(controller.activeHeavy, 0);
});

test("espera acima do orçamento devolve a espera MEDIDA, não o valor nominal", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const started = Date.now();
  const result = await controller.acquireHeavy({ maxWaitMs: 120 });
  const elapsed = Date.now() - started;

  assert.equal(result.lease, null);
  assert.equal(result.reason, "wait-timeout");
  assert.ok(result.waitedMs >= 120, "a espera reportada é a real");
  assert.ok(
    Math.abs(result.waitedMs - elapsed) < 80,
    `a espera reportada (${result.waitedMs}ms) bate com a decorrida (${elapsed}ms)`
  );
  occupied.release();
});

test("aborto durante a espera libera imediatamente e não vaza vaga", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const abort = new AbortController();
  const pending = controller.acquireHeavy({ maxWaitMs: 5000, signal: abort.signal });
  await new Promise((resolve) => setTimeout(resolve, 40));
  abort.abort();

  const result = await pending;
  assert.equal(result.lease, null);
  assert.equal(result.reason, "aborted");

  occupied.release();
  assert.equal(controller.activeHeavy, 0, "o desistente não pode deixar a vaga presa");

  // E a vaga liberada tem que estar realmente livre para o próximo.
  const next = controller.tryAcquireHeavy();
  assert.ok(next);
  next.release();
});

test("fila cheia rejeita na hora, sem esperar — é a válvula que protege o heap", async () => {
  const controller = new ChatAdmissionController(1, 2);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const a = controller.acquireHeavy({ maxWaitMs: 3000 });
  const b = controller.acquireHeavy({ maxWaitMs: 3000 });
  await new Promise((resolve) => setTimeout(resolve, 30));

  const started = Date.now();
  const overflow = await controller.acquireHeavy({ maxWaitMs: 3000 });
  const elapsed = Date.now() - started;

  assert.equal(overflow.lease, null);
  assert.equal(overflow.reason, "queue-full");
  assert.ok(elapsed < 100, `rejeitou de imediato (${elapsed}ms), não consumiu o orçamento`);

  occupied.release();
  (await a).lease?.release();
  (await b).lease?.release();
});

test("a vaga é passada em ordem de chegada — recém-chegado não fura a fila", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const order: string[] = [];
  const first = controller.acquireHeavy({ maxWaitMs: 3000 }).then((r) => {
    order.push("first");
    return r;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = controller.acquireHeavy({ maxWaitMs: 3000 }).then((r) => {
    order.push("second");
    return r;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  occupied.release();
  const firstResult = await first;
  assert.ok(firstResult.lease);
  firstResult.lease.release();
  const secondResult = await second;
  assert.ok(secondResult.lease);
  secondResult.lease.release();

  assert.deepEqual(order, ["first", "second"]);
  assert.equal(controller.activeHeavy, 0);
});

test("maxWaitMs zero preserva o comportamento atual: rejeição imediata", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const started = Date.now();
  const result = await controller.acquireHeavy({ maxWaitMs: 0 });
  assert.equal(result.lease, null);
  assert.equal(result.reason, "wait-timeout");
  assert.ok(Date.now() - started < 50);
  occupied.release();
});

test("admitChatRequest espera pela vaga em vez de devolver 503 na hora", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  setTimeout(() => occupied.release(), 80);

  const result = await admitChatRequest(bigRequest(2048), {
    controller,
    largeBodyBytes: 512,
    hardMaxBytes: 1024 * 1024,
    maxWaitMs: 2000,
  });

  assert.equal(result.admit, true, "hoje isto vira 503 imediato");
  if (result.admit) result.lease?.release();
  assert.equal(controller.activeHeavy, 0);
});

test("admitChatStructure também espera, e não só o caminho de bytes", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  setTimeout(() => occupied.release(), 80);

  const result = await admitChatStructure(
    { messages: [], tools: [{ type: "function" }, { type: "function" }] },
    null,
    { controller, maxMessages: 10, heavyMessages: 10, heavyTools: 2, heavyTokens: 10_000, maxWaitMs: 2000 }
  );

  assert.equal(result.admit, true);
  if (result.admit) result.lease?.release();
  assert.equal(controller.activeHeavy, 0);
});

test("limite rígido de bytes continua 413 sem passar pela fila", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const started = Date.now();
  const result = await admitChatRequest(bigRequest(4096), {
    controller,
    largeBodyBytes: 512,
    hardMaxBytes: 1024,
    maxWaitMs: 5000,
  });

  assert.equal(result.admit, false);
  if (result.admit) return;
  assert.equal(result.response.status, 413);
  assert.ok(Date.now() - started < 200, "413 é terminal — esperar por vaga não muda nada");
  occupied.release();
});

test("estouro do orçamento ainda devolve 503 e reporta a espera medida", async () => {
  const controller = new ChatAdmissionController(1);
  const occupied = controller.tryAcquireHeavy();
  assert.ok(occupied);

  const result = await admitChatRequest(bigRequest(2048), {
    controller,
    largeBodyBytes: 512,
    hardMaxBytes: 1024 * 1024,
    maxWaitMs: 100,
  });

  assert.equal(result.admit, false);
  if (result.admit) return;
  assert.equal(result.response.status, 503);
  assert.equal((await result.response.json()).error.code, "chat_admission_busy");
  assert.ok(result.rejection);
  assert.equal(result.rejection.reason, "wait-timeout");
  assert.ok(result.rejection.waitedMs >= 100, "a rejeição carrega a espera real");
  occupied.release();
});
