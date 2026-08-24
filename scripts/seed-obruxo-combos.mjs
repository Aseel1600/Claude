#!/usr/bin/env node
/**
 * Seed dos 4 combos inteligentes do Obruxo no OmniRoute.
 *
 * Cria (ou atualiza via --update) os modelos lógicos:
 *   - orq-easy    → tarefas leves: leitura, busca, explicação, diagnóstico simples
 *   - orq-medium  → desenvolvimento normal: implementar, bugfix comum, refactor moderado
 *   - orq-hard    → arquitetura, bugs difíceis, segurança, migrations, revisão profunda
 *   - orq-auto    → o sistema decide o esforço (pool misto)
 *
 * Todos usam `strategy: "auto"` (combo inteligente, scoring multi-fator).
 * O Obruxo/IA-ONE só envia `{ "model": "orq-*" }` — o OmniRoute resolve
 * provider/modelo real por request.
 *
 * Uso:
 *   OMNIRoute_URL=http://localhost:20128 node scripts/seed-obruxo-combos.mjs
 *   node scripts/seed-obruxo-combos.mjs --update        # PUT em vez de falhar se já existe
 *   node scripts/seed-obruxo-combos.mjs --dry-run       # só imprime os payloads
 *
 * Auth: se a instância exigir management auth, exporte OMNIRoute_TOKEN
 * (API key de gerenciamento) que será enviada como Bearer token.
 *
 * Ajuste os `candidatePool` abaixo para os providers que VOCÊ tem conectados.
 * Pool vazio ([]) significa "todos os providers ativos".
 */

const BASE_URL = (process.env.OMNIROUTE_URL || "http://localhost:20128").replace(/\/$/, "");
const TOKEN = process.env.OMNIROUTE_TOKEN || "";
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const UPDATE = args.has("--update");

/** ── Ajuste aqui conforme seus providers conectados ─────────────────────── */
const POOLS = {
  // Baratos/rápidos com free tier generoso — edite para o que você tem ativo
  cheap: ["groq", "gemini", "cerebras", "siliconflow", "mistral"],
  // Meio-termo: bons em tool calling, custo moderado
  mid: ["groq", "gemini", "deepseek", "mistral", "openrouter"],
  // Frontier: raciocínio forte, contexto grande
  strong: ["anthropic", "openai", "gemini", "deepseek"],
  // orq-auto: pool misto (vazio = todos os providers ativos)
  all: [],
};

/** Weights completos (normalizados pelo engine — não precisam somar 1). */
const COMBOS = [
  {
    name: "orq-easy",
    description:
      "[Obruxo] Tarefas leves: leitura, busca, explicação, docs, diagnóstico simples. Custo/latência primeiro.",
    strategy: "auto",
    models: [],
    config: {
      candidatePool: POOLS.cheap,
      modePack: "cost-saver",
      explorationRate: 0.05,
      routerStrategy: "rules",
      weights: {
        quota: 0.15,
        health: 0.2,
        costInv: 0.35,
        latencyInv: 0.2,
        taskFit: 0.05,
        stability: 0.05,
        contextAffinity: 0,
        tierPriority: 0,
      },
      budgetCap: 0.005,
      budgetFallback: "cheapest",
    },
  },
  {
    name: "orq-medium",
    description:
      "[Obruxo] Desenvolvimento normal: implementar, bugfix comum, refactor moderado, revisão de diff simples.",
    strategy: "auto",
    models: [],
    config: {
      candidatePool: POOLS.mid,
      modePack: "ship-fast",
      explorationRate: 0.05,
      routerStrategy: "rules",
      weights: {
        quota: 0.1,
        health: 0.2,
        costInv: 0.1,
        latencyInv: 0.15,
        taskFit: 0.25,
        stability: 0.1,
        contextAffinity: 0.1,
        tierPriority: 0,
      },
      slaTargetP95Ms: 30000,
      slaMaxErrorRate: 0.08,
      slaHardConstraints: false,
    },
  },
  {
    name: "orq-hard",
    description:
      "[Obruxo] Arquitetura, bugs difíceis, segurança, migrations, dados críticos, revisão profunda. Qualidade primeiro.",
    strategy: "auto",
    models: [],
    config: {
      candidatePool: POOLS.strong,
      modePack: "quality-first",
      explorationRate: 0.02,
      routerStrategy: "rules",
      weights: {
        quota: 0.05,
        health: 0.15,
        costInv: 0.02,
        latencyInv: 0.03,
        taskFit: 0.4,
        stability: 0.15,
        contextAffinity: 0.15,
        tierPriority: 0.05,
      },
      slaTargetP95Ms: 120000,
      slaMaxErrorRate: 0.03,
      slaHardConstraints: false,
    },
  },
  {
    name: "orq-auto",
    description:
      "[Obruxo] O sistema escolhe o esforço: cai em modelo barato para tarefa simples e em modelo forte para tarefa arriscada/complexa.",
    strategy: "auto",
    models: [],
    config: {
      // Pool vazio = todos os providers ativos (o engine interpreta [] como "all").
      candidatePool: POOLS.all,
      // Sem modePack = DEFAULT_WEIGHTS balanceados.
      explorationRate: 0.1,
      routerStrategy: "rules",
      weights: {
        quota: 0.15,
        health: 0.2,
        costInv: 0.15,
        latencyInv: 0.12,
        taskFit: 0.2,
        stability: 0.08,
        contextAffinity: 0.05,
        tierPriority: 0.05,
      },
    },
  },
];

async function comboExists(name) {
  const res = await fetch(`${BASE_URL}/api/combos?limit=500`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /api/combos falhou: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.combos || []).find((c) => c.name === name);
}

function headers() {
  const h = { "content-type": "application/json" };
  if (TOKEN) h.authorization = `Bearer ${TOKEN}`;
  return h;
}

async function upsert(combo) {
  const existing = await comboExists(combo.name);
  if (existing && !UPDATE) {
    console.log(`⏭️  ${combo.name} já existe (id=${existing.id}). Use --update para sobrescrever.`);
    return;
  }
  const url = existing ? `${BASE_URL}/api/combos/${existing.id}` : `${BASE_URL}/api/combos`;
  const method = existing ? "PUT" : "POST";
  const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(combo) });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ ${combo.name}: ${method} ${res.status} — ${text}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `${existing ? "♻️  atualizado" : "✅ criado"}: ${combo.name} (${method} ${res.status})`
  );
}

console.log(`🎩 Obruxo → OmniRoute seed (${BASE_URL})${DRY_RUN ? " [DRY-RUN]" : ""}`);
for (const combo of COMBOS) {
  if (DRY_RUN) {
    console.log(`\n--- ${combo.name} ---`);
    console.log(JSON.stringify(combo, null, 2));
  } else {
    await upsert(combo);
  }
}
console.log("\nPronto. Teste com:");
console.log(`  curl ${BASE_URL}/v1/chat/completions -H 'content-type: application/json' \\`);
console.log(`    -d '{"model":"orq-medium","messages":[{"role":"user","content":"oi"}]}'`);
