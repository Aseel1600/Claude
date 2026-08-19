#!/usr/bin/env node
// scripts/check/check-vercel-react-best-practices.mjs
// Gate de Vercel React Best Practices (vercel/react-best-practices — 70 regras, 8
// categorias) + Web Interface Guidelines (vercel-labs/web-interface-guidelines) para
// o SUBCONJUNTO mecanicamente detectável por análise estática.
//
// Cada regra mapeia para um ID do guia Vercel (vercel-react-best-practices AGENTS.md)
// ou para uma Web Interface Guideline:
//   transitionAll           → Web Guideline "Never transition: all — list properties"
//   outlineNoneNoFocus      → Web Guideline "Never outline-none without focus replacement"
//   divOnClickNoKeyboard    → fixing-accessibility "keyboard access" / Web "button for actions"
//   imgMissingDimensions    → Web Guideline "img needs explicit width and height (CLS)"
//   imgMissingAlt           → Web Guideline "Images need alt (or alt= if decorative)"
//   loadingEllipsis         → Web Guideline "Loading states end with …"
//   toLocaleUndefined       → Web Guideline "Numbers/dates via Intl.* with fixed locale"
//   userScalableNo          → Web Guideline anti-pattern "user-scalable=no / maximum-scale=1"
//   onPastePreventDefault   → Web Guideline anti-pattern "onPaste with preventDefault"
//   noReducedMotionFile     → Web Guideline "Muted decorative loops must stop under prefers-reduced-motion"
//   iconButtonNoLabel       → fixing-accessibility "icon-only buttons must have aria-label"
//
// RATCHET BLOQUEANTE (default): lê metrics.vercelReact.<ruleId>.value de
// config/quality/quality-baseline.json e SAI 1 SE — E SOMENTE SE — a contagem
// MEDIDA for MAIOR que o baseline (regressão real, nova violação). Violações
// pré-existentes ficam congeladas no baseline — a dívida existente não bloqueia,
// mas qualquer violação NOVA é red imediato.
// Direction: down (a contagem só pode CAIR). Suporta --update para ratchetar.
//
// Uso:
//   node scripts/check/check-vercel-react-best-practices.mjs
//   node scripts/check/check-vercel-react-best-practices.mjs --update   # ratcheta o baseline
//   node scripts/check/check-vercel-react-best-practices.mjs --advisory # nunca falha (modo coletor)
//   node scripts/check/check-vercel-react-best-practices.mjs --json     # findings como JSON
//   node scripts/check/check-vercel-react-best-practices.mjs --quiet    # suprime detalhe

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const QUIET = process.argv.includes("--quiet");
const PRINT_JSON = process.argv.includes("--json");
const UPDATE = process.argv.includes("--update");
// --advisory: nunca falha pela contagem (modo coletor legado). Sem esta flag o
// gate é BLOQUEANTE: sai 1 numa regressão real (medida > baseline).
const ADVISORY = process.argv.includes("--advisory");

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, "config/quality/quality-baseline.json");

// Regras: id (usado como sufixo da métrica), descrição (só para o --help/--json)
export const RULES = [
  { id: "transitionAll", description: "transition-all / transition: all — list properties explicitly" },
  { id: "outlineNoneNoFocus", description: "outline-none without focus-visible:ring replacement" },
  { id: "divOnClickNoKeyboard", description: "<div onClick> without role/tabIndex/onKeyDown keyboard access" },
  { id: "imgMissingDimensions", description: "<img> without width/height (CLS)" },
  { id: "imgMissingAlt", description: "<img> without alt" },
  { id: "loadingEllipsis", description: 'Loading... should be "Loading…"' },
  { id: "toLocaleUndefined", description: "toLocale* with undefined locale — use Intl.* with fixed locale" },
  { id: "userScalableNo", description: "user-scalable=no / maximum-scale=1 disables zoom" },
  { id: "onPastePreventDefault", description: "onPaste + preventDefault blocks paste" },
  { id: "noReducedMotionFile", description: "file has animations but no prefers-reduced-motion guard" },
  { id: "iconButtonNoLabel", description: "icon-only button (material-symbols-outlined) without aria-label" },
];

const RULE_IDS = new Set(RULES.map((r) => r.id));

// ---------------------------------------------------------------------------
// Scanning helpers (pure — exported for tests)
// ---------------------------------------------------------------------------

/**
 * Extrai os atributos de um elemento JSX/HTML começando em `start` (índice do
 * `<tag`) até o `>` de fechamento, respeitando aspas. Retorna { end, props }
 * onde props é a string bruta entre o nome da tag e o `>`.
 */
export function extractElementProps(source, start) {
  // JSX-aware: `>` só fecha o elemento quando estamos FORA de aspas e FORA de
  // chaves de expressão JSX — senão `=>` de arrow functions e `{"a > b"}`
  // truncariam o scan no meio dos props.
  let i = start;
  let braceDepth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) i += 1;
    } else if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      braceDepth -= 1;
    } else if (ch === ">" && braceDepth === 0) {
      break;
    }
    i += 1;
  }
  return { end: i, props: source.slice(start, i) };
}

function hasProp(props, pattern) {
  return pattern.test(props);
}

/**
 * Escaneia o conteúdo de um arquivo e retorna findings [{ ruleId, line, snippet }].
 * `fileRel` é usado apenas para testes de mensagens legíveis — o caller junta o path.
 */
export function scanSourceFile(source, fileRel = "<file>") {
  const findings = [];
  const lines = source.split("\n");
  const isTsx = fileRel.endsWith(".tsx") || fileRel.endsWith(".jsx");
  const isCss = fileRel.endsWith(".css");
  if (!isTsx && !isCss) return findings;

  const push = (ruleId, line, snippet) => findings.push({ ruleId, file: fileRel, line, snippet });

  // 1. transitionAll — nunca `transition: all`; liste propriedades.
  const transitionRe = isCss ? /transition:\s*all\b/g : /transition-all|transition:\s*all\b/g;
  for (const m of source.matchAll(transitionRe)) {
    const line = source.slice(0, m.index).split("\n").length;
    push("transitionAll", line, m[0]);
  }

  // 2. outlineNoneNoFocus — `outline-none` sem replacement de foco na mesma linha.
  if (isTsx) {
    lines.forEach((line, idx) => {
      if (line.includes("outline-none") && !/focus(?:-visible)?:ring/.test(line)) {
        push("outlineNoneNoFocus", idx + 1, line.trim().slice(0, 120));
      }
    });
  }

  // 3. divOnClickNoKeyboard — <div onClick> sem role/tabIndex/onKeyDown no elemento.
  // 4/5. imgMissingDimensions / imgMissingAlt
  if (isTsx) {
    const tagRe = /<(div|img)\b/g;
    for (const m of allMatches(source, tagRe)) {
      const { end, props } = extractElementProps(source, m.index);
      const tag = m[1];
      const line = source.slice(0, m.index).split("\n").length;
      if (tag === "div") {
        if (hasProp(props, /\bonClick\s*=/)) {
          const hasKeyboard =
            hasProp(props, /\bonKeyDown\s*=/) ||
            hasProp(props, /\bonKeyUp\s*=/) ||
            hasProp(props, /\brole\s*=/) ||
            hasProp(props, /\btabIndex\s*=/);
          if (!hasKeyboard) {
            push("divOnClickNoKeyboard", line, props.trim().slice(0, 120));
          }
        }
      } else if (tag === "img") {
        if (!hasProp(props, /\balt\s*=/)) {
          push("imgMissingAlt", line, props.trim().slice(0, 120));
        } else if (
          !hasProp(props, /\bwidth\s*=/) ||
          !hasProp(props, /\bheight\s*=/)
        ) {
          push("imgMissingDimensions", line, props.trim().slice(0, 120));
        }
      }
      // pular o props já consumido: retomar de `end` para não re-parsear a mesma tag
      tagRe.lastIndex = end + 1;
    }
  }

  // 6. loadingEllipsis — "Loading..." deve ser "Loading…"
  if (isTsx) {
    const ellipsisRe = /["'`]Loading\.\.\.["'`]|["'`]loading\.\.\.["'`]/g;
    for (const m of source.matchAll(ellipsisRe)) {
      const line = source.slice(0, m.index).split("\n").length;
      push("loadingEllipsis", line, m[0]);
    }
  }

  // 7. toLocaleUndefined — locale undefined = formato dependente do runtime.
  if (isTsx || fileRel.endsWith(".ts")) {
    const localeRe = /toLocale(?:String|DateString|TimeString)\(\s*undefined\s*,/g;
    for (const m of source.matchAll(localeRe)) {
      const line = source.slice(0, m.index).split("\n").length;
      push("toLocaleUndefined", line, m[0]);
    }
  }

  // 8. userScalableNo — zoom desabilitado (WCAG 1.4.4).
  const zoomRe = /user-scalable\s*=\s*["']?no|maximum-scale\s*=\s*["']?1([^0-9]|$)/g;
  for (const m of source.matchAll(zoomRe)) {
    const line = source.slice(0, m.index).split("\n").length;
    push("userScalableNo", line, m[0]);
  }

  // 9. onPastePreventDefault — bloqueia colar.
  if (isTsx) {
    const onPasteRe = /\bonPaste\s*=\s*\{/g;
    for (const m of source.matchAll(onPasteRe)) {
      const handler = source.slice(m.index, m.index + 400);
      if (/preventDefault\s*\(/.test(handler)) {
        const line = source.slice(0, m.index).split("\n").length;
        push("onPastePreventDefault", line, m[0]);
      }
    }
  }

  // 10. noReducedMotionFile — animações decorativas sem guarda de movimento reduzido.
  const hasAnimation = /@keyframes|\banimation\s*:|\banimate-/.test(source);
  if (hasAnimation && !/prefers-reduced-motion/.test(source)) {
    const m = source.match(/@keyframes|\banimation\s*:|\banimate-/);
    const line = source.slice(0, m.index).split("\n").length;
    push("noReducedMotionFile", line, m[0]);
  }

  // 11. iconButtonNoLabel — botão de ícone (material-symbols-outlined) sem nome acessível.
  // Heurística conservadora: só sinaliza quando o conteúdo do botão, depois de remover
  // os blocos <span>...</span> e tags, não resta TEXTO visível — ou seja, é um botão
  // exclusivamente de ícone. Botões com texto + ícone não são sinalizados.
  if (isTsx) {
    const btnRe = /<button\b/g;
    for (const m of allMatches(source, btnRe)) {
      const { end, props } = extractElementProps(source, m.index);
      // Nome acessível: aria-label/aria-labelledby OU title (o title é fonte de nome
      // na computação WCAG; sem ele, só resta o conteúdo — e o conteúdo é só o ícone).
      const hasName = hasProp(props, /\b(?:aria-label|aria-labelledby)\s*=/) || hasProp(props, /\btitle\s*=/);
      if (!hasName) {
        // Corpo do botão = até o </button> correspondente (não um janela fixa, que
        // vaza para o próximo sibling). Fallback de 600 chars se o close não existir.
        const closeIdx = source.indexOf("</button>", end + 1);
        const body =
          closeIdx === -1 ? source.slice(end + 1, end + 601) : source.slice(end + 1, closeIdx);
        if (/material-symbols-outlined/.test(body)) {
          // Remove SÓ os spans de ícone (material-symbols-outlined); spans de texto
          // (labels, contadores) permanecem como TEXTO visível.
          const withoutIconSpans = body.replace(
            /<span\b[^>]*material-symbols-outlined[^>]*>[\s\S]*?<\/span>/g,
            ""
          );
          // Resta apenas o que seria TEXTO visível: remove tags e ruído sintático de
          // JSX ({cond && ( ... )}, comentários /* */, chaves de expressão).
          const visibleText = withoutIconSpans
            .replace(/<[^>]+>/g, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/[{}()[\].;:&|?!,="']/g, "")
            .replace(/\s+/g, "");
          if (visibleText.length === 0) {
            const line = source.slice(0, m.index).split("\n").length;
            push("iconButtonNoLabel", line, props.trim().slice(0, 120));
          }
        }
      }
      btnRe.lastIndex = end + 1;
    }
  }

  return findings;
}

/** matchAll que não quebra quando a regex tem /g mas o source é grande — alias simples. */
function allMatches(source, re) {
  const out = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filesystem walk (src/ apenas — a UI da aplicação)
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "__tests__", ".git"]);

function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walkFiles(path.join(dir, entry.name), acc);
    } else if (
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".css") || entry.name.endsWith(".ts")) &&
      !/\.(test|spec)\./.test(entry.name)
    ) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Ratchet evaluation (pure — exported for tests)
// ---------------------------------------------------------------------------

/**
 * Compara a contagem medida com o baseline de uma métrica.
 * Regressão = medida > baseline (direction "down": a dívida só pode cair).
 */
export function evaluateRatchet(measured, baselineValue) {
  return { regressed: measured > baselineValue, improved: measured < baselineValue };
}

export function groupFindings(findings) {
  const byRule = {};
  for (const f of findings) {
    (byRule[f.ruleId] ||= []).push(f);
  }
  return byRule;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const files = walkFiles(path.join(ROOT, "src"));
  const findings = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue; // arquivo sumiu no meio do walk — SKIP gracioso
    }
    findings.push(...scanSourceFile(source, rel));
  }

  const byRule = groupFindings(findings);
  const measured = {};
  for (const rule of RULES) {
    measured[rule.id] = byRule[rule.id]?.length ?? 0;
  }

  let baseline = {};
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    baseline = {};
  }

  const regressions = [];
  for (const rule of RULES) {
    const metricKey = `vercelReact.${rule.id}`;
    const baselineValue = baseline.metrics?.[metricKey]?.value;
    if (typeof baselineValue !== "number") continue; // métrica nova sem baseline → ignora até --update
    const { regressed } = evaluateRatchet(measured[rule.id], baselineValue);
    if (regressed) regressions.push(rule.id);
  }

  if (UPDATE) {
    const metrics = baseline.metrics ?? {};
    const note = `Rebaseline em ${new Date().toISOString().slice(0, 10)} — vercel/react-best-practices gate (subconjunto estático).`;
    for (const rule of RULES) {
      const metricKey = `vercelReact.${rule.id}`;
      metrics[metricKey] = { value: measured[rule.id], direction: "down", note };
    }
    baseline.metrics = metrics;
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    if (!QUIET) console.log(`vercelReact baseline updated at ${path.relative(ROOT, BASELINE_PATH)}`);
  }

  if (PRINT_JSON) {
    console.log(JSON.stringify({ measured, byRule }, null, 2));
    return;
  }

  if (!QUIET) {
    for (const rule of RULES) {
      const metricKey = `vercelReact.${rule.id}`;
      const base = baseline.metrics?.[metricKey]?.value ?? "n/a";
      console.log(`${metricKey}=${measured[rule.id]} (baseline ${base})`);
    }
    // Detalhe das regressões (violações NOVAS)
    for (const ruleId of regressions) {
      console.log(`\n❌ ${ruleId} — NOVAS violações (${byRule[ruleId].length} total):`);
      for (const f of byRule[ruleId]) {
        console.log(`  ${f.file}:${f.line} - ${f.snippet}`);
      }
    }
    if (regressions.length === 0) {
      const total = findings.length;
      console.log(`\n✓ ${total} violações conhecidas (congeladas no baseline). Nenhuma regressão.`);
    }
  }

  if (regressions.length > 0 && !ADVISORY) {
    console.error(`\nvercel-react gate: ${regressions.length} regra(s) regrediram. Fixe as violações novas ou rode --update se a mudança for intencional.`);
    process.exit(1);
  }
}

// Só executa quando chamado diretamente (não quando importado pelos testes).
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
