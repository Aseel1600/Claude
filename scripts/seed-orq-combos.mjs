#!/usr/bin/env node
/**
 * Seed: cria os 4 combos inteligentes orq-* para o projeto Obruxo
 *
 * Uso:
 *   node scripts/seed-orq-combos.mjs [--dry-run] [--api-url=http://localhost:3000]
 *
 * Requisitos:
 *   - OmniRoute rodando (dev ou prod)
 *   - Combos de pool já existentes no banco:
 *     deepseek-v4-flash, KIMI CODE, KIMI [1M], GEMINI FLASH [1M],
 *     GEMINI LITE [1M], GEMINI PRO [1M], CLAUDE VALUE [1M], CLAUDE OPUS [1M]
 */

const API_URL = process.argv.includes("--api-url")
  ? process.argv[process.argv.indexOf("--api-url") + 1]
  : process.env.OMNIROUTE_API_URL || "http://localhost:3000";

const DRY_RUN = process.argv.includes("--dry-run");

// ============================================================================
// CONFIGURAÇÃO DOS 4 COMBOS INTELIGENTES
// ============================================================================

const ORQ_COMBOS = [
  {
    name: "orq-easy",
    description: "Obruxo: tarefas leves — leitura, busca, doc, diagnóstico simples",
    strategy: "auto",
    config: {
      candidatePool: [], // vazio = usa combo-refs como pool
      modePack: "cost-saver",
      explorationRate: 0.05,
      budgetCap: 0.002, // $0.002 por request (2/10 de centavo)
      slaTargetP95Ms: 8000,
      slaMaxErrorRate: 0.05,
      slaHardConstraints: false,
      weights: {
        quota: 0.2,
        health: 0.18,
        costInv: 0.3, // custo é rei no easy
        latencyInv: 0.15,
        taskFit: 0.05,
        stability: 0.05,
        tierPriority: 0.02,
        tierAffinity: 0.02,
        specificityMatch: 0.01,
        contextAffinity: 0.02,
        cacheAffinity: 0,
        resetWindowAffinity: 0,
      },
    },
    // combo-refs: modelos baratos e rápidos (1M context)
    models: [
      { kind: "combo-ref", comboName: "deepseek-v4-flash", weight: 40 },
      { kind: "combo-ref", comboName: "GEMINI FLASH [1M]", weight: 35 },
      { kind: "combo-ref", comboName: "GEMINI LITE [1M]", weight: 25 },
    ],
  },

  {
    name: "orq-medium",
    description: "Obruxo: desenvolvimento normal — implementar, bug comum, refactor moderado",
    strategy: "auto",
    config: {
      candidatePool: [],
      modePack: "ship-fast",
      explorationRate: 0.05,
      budgetCap: 0.01, // $0.01 por request
      slaTargetP95Ms: 15000,
      slaMaxErrorRate: 0.03,
      slaHardConstraints: false,
      weights: {
        quota: 0.12,
        health: 0.2,
        costInv: 0.15,
        latencyInv: 0.12,
        taskFit: 0.2, // taskFit importa mais no medium
        stability: 0.1,
        tierPriority: 0.03,
        tierAffinity: 0.03,
        specificityMatch: 0.02,
        contextAffinity: 0.03,
        cacheAffinity: 0,
        resetWindowAffinity: 0,
      },
    },
    // combo-refs: equilíbrio custo/qualidade
    models: [
      { kind: "combo-ref", comboName: "KIMI CODE", weight: 35 },
      { kind: "combo-ref", comboName: "KIMI [1M]", weight: 30 },
      { kind: "combo-ref", comboName: "deepseek-v4-flash", weight: 20 },
      { kind: "combo-ref", comboName: "GEMINI FLASH [1M]", weight: 15 },
    ],
  },

  {
    name: "orq-hard",
    description: "Obruxo: arquitetura, bugs difíceis, segurança, migração, revisão profunda",
    strategy: "auto",
    config: {
      candidatePool: [],
      modePack: "quality-first",
      explorationRate: 0.02, // explora pouco — quer o melhor
      budgetCap: 0.05, // $0.05 por request (cinco centavos)
      slaTargetP95Ms: 30000,
      slaMaxErrorRate: 0.02,
      slaHardConstraints: true, // hard constraints no hard
      weights: {
        quota: 0.08,
        health: 0.15,
        costInv: 0.02, // custo quase não importa no hard
        latencyInv: 0.05,
        taskFit: 0.35, // taskFit é rei no hard
        stability: 0.15,
        tierPriority: 0.05,
        tierAffinity: 0.05,
        specificityMatch: 0.05,
        contextAffinity: 0.05,
        cacheAffinity: 0,
        resetWindowAffinity: 0,
      },
    },
    // combo-refs: frontier + mid como respiro
    models: [
      { kind: "combo-ref", comboName: "CLAUDE OPUS [1M]", weight: 40 },
      { kind: "combo-ref", comboName: "CLAUDE VALUE [1M]", weight: 25 },
      { kind: "combo-ref", comboName: "GEMINI PRO [1M]", weight: 20 },
      { kind: "combo-ref", comboName: "KIMI [1M]", weight: 15 }, // respiro
    ],
  },

  {
    name: "orq-auto",
    description: "Obruxo: sistema escolhe o esforço — pool misto, exploração alta",
    strategy: "auto",
    config: {
      candidatePool: [],
      modePack: undefined, // sem pack = default weights
      explorationRate: 0.1, // explora mais
      budgetCap: 0.02,
      slaTargetP95Ms: 20000,
      slaMaxErrorRate: 0.04,
      slaHardConstraints: false,
      weights: {
        quota: 0.14,
        health: 0.18,
        costInv: 0.18,
        latencyInv: 0.12,
        taskFit: 0.15,
        stability: 0.08,
        tierPriority: 0.04,
        tierAffinity: 0.04,
        specificityMatch: 0.03,
        contextAffinity: 0.04,
        cacheAffinity: 0,
        resetWindowAffinity: 0,
      },
    },
    // combo-refs: todos os pools
    models: [
      { kind: "combo-ref", comboName: "deepseek-v4-flash", weight: 20 },
      { kind: "combo-ref", comboName: "GEMINI FLASH [1M]", weight: 15 },
      { kind: "combo-ref", comboName: "KIMI CODE", weight: 20 },
      { kind: "combo-ref", comboName: "KIMI [1M]", weight: 15 },
      { kind: "combo-ref", comboName: "CLAUDE VALUE [1M]", weight: 15 },
      { kind: "combo-ref", comboName: "CLAUDE OPUS [1M]", weight: 10 },
      { kind: "combo-ref", comboName: "GEMINI PRO [1M]", weight: 5 },
    ],
  },
];

// ============================================================================
// PAYLOAD PARA API
// ============================================================================

function buildComboPayload(combo) {
  return {
    name: combo.name,
    description: combo.description,
    strategy: combo.strategy,
    config: combo.config,
    models: combo.models.map((m, i) => ({
      id: `${combo.name}-step-${i + 1}`,
      kind: m.kind,
      comboName: m.comboName,
      weight: m.weight,
      label: m.comboName,
    })),
  };
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

async function main() {
  console.log("🌱 Seed Obruxo — 4 combos inteligentes orq-*");
  console.log(`📡 API: ${API_URL}`);
  console.log(`🧪 Dry-run: ${DRY_RUN ? "SIM" : "NÃO"}`);
  console.log("");

  for (const combo of ORQ_COMBOS) {
    const payload = buildComboPayload(combo);

    console.log(`📦 ${combo.name}`);
    console.log(`   refs: ${combo.models.map((m) => m.comboName).join(", ")}`);
    console.log(`   modePack: ${combo.config.modePack || "default"}`);
    console.log(`   exploration: ${combo.config.explorationRate}`);
    console.log("");

    if (DRY_RUN) {
      console.log("   [DRY-RUN] payload:");
      console.log(
        JSON.stringify(payload, null, 2)
          .split("\n")
          .map((l) => "   " + l)
          .join("\n")
      );
      console.log("");
      continue;
    }

    try {
      const res = await fetch(`${API_URL}/api/combos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        console.log(`   ❌ ERRO ${res.status}: ${err}`);
      } else {
        const created = await res.json();
        console.log(`   ✅ Criado: ${created.id || combo.name}`);
      }
    } catch (err) {
      console.log(`   ❌ FALHA: ${err.message}`);
    }
    console.log("");
  }

  console.log("🏁 Seed concluído!");
  console.log("");
  console.log("Para testar:");
  console.log(`  curl ${API_URL}/v1/chat/completions \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"model": "orq-easy", "messages": [{"role":"user","content":"hello"}]}\'');
}

main().catch(console.error);
