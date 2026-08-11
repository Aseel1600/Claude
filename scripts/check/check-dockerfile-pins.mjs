#!/usr/bin/env node
// scripts/check/check-dockerfile-pins.mjs
// Gate de pins do Dockerfile: falha se a imagem base (Node) ou o npm global
// instalado no build driftar das versões pinadas.
// WHY: incidente 2026-08-10 — a tag flutuante `node:22` do Docker Hub mudou para
// um runtime cujo teardown aborta better-sqlite3 (SIGABRT) durante `next build`
// no Railway. Tags flutuantes (node:22, npm@latest) quebram o build de forma
// não-reproduzível. Este gate (CI) + o guard RUN dentro do próprio Dockerfile
// (protege o build do Railway, que não roda as Actions do fork) mantêm os dois
// pins travados. Quando atualizar um, atualize AMBOS:
//   - Dockerfile: linha FROM + RUN npm install -g npm@<versão>
//   - este arquivo: PINNED_NODE_IMAGE / PINNED_NODE_VERSION / PINNED_NPM_VERSION
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const DEFAULT_DOCKERFILE = path.join(ROOT, "Dockerfile");

export const PINNED_NODE_IMAGE = "node:22.23.1-bookworm-slim";
// Deve bater com a saída de `node --version` dentro da imagem pinada.
// 22.23.2 was SKIPPED deliberately: it SIGSEGV'd a next-build worker locally
// (build emitted no standalone bundle). Se você digest-pinar a imagem
// (node:...@sha256:...), atualize o PINNED_NODE_IMAGE para a forma exata da
// linha FROM — o gate falha de propósito para forçar a atualização deliberada
// (não "corrija" removendo o digest).
export const PINNED_NODE_VERSION = "v22.23.1";
export const PINNED_NPM_VERSION = "11.19.0";

const FROM_RE = /^\s*FROM\s+(\S+)/;
const NPM_INSTALL_G_RE = /npm\s+install\s+-g\b/;
const NPM_PIN_RE = /npm@([\w.-]+)/g;
// Guard RUN no Dockerfile: `node --version | grep -qx "vX.Y.Z"` (protege o build
// do Railway, que não roda as Actions do fork). O gate cruza a versão do guard
// com a versão derivada da imagem base pinada para não haver uma terceira cópia
// solta da verdade.
const GUARD_RE = /node\s+--version\s*\|\s*grep\s+-qx\s+"(v[\d.]+)"/;

/**
 * Função pura — detecta drift dos pins do Dockerfile.
 *
 * @param {string[]} lines               linhas do Dockerfile
 * @param {string} pinnedNodeImage       imagem base pinada (ex.: "node:22.23.2-bookworm-slim")
 * @param {string} pinnedNpmVersion      versão do npm pinada (ex.: "12.0.2")
 * @param {string} pinnedNodeVersion     versão do Node que o guard RUN deve conferir (ex.: "v22.23.2")
 * @returns {string[]} problemas (mensagens com número da linha) — vazio = OK
 */
export function evaluateDockerfilePins(
  lines,
  pinnedNodeImage,
  pinnedNpmVersion,
  pinnedNodeVersion
) {
  const problems = [];
  let nodePinnedSeen = false;
  let nodeDriftFlagged = false;
  let npmPinnedSeen = false;
  let npmDriftFlagged = false;
  let guardVersion = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    const fromMatch = line.match(FROM_RE);
    if (fromMatch) {
      const image = fromMatch[1];
      if (image.startsWith("node:")) {
        if (image !== pinnedNodeImage) {
          nodeDriftFlagged = true;
          problems.push(
            `line ${lineNo}: FROM ${image} — expected pinned base image ${pinnedNodeImage} ` +
              `(floating node tags drift and broke the 2026-08-10 Railway build)`
          );
        } else {
          nodePinnedSeen = true;
        }
      }
      continue;
    }

    const guardMatch = line.match(GUARD_RE);
    if (guardMatch) {
      guardVersion = guardMatch[1];
      continue;
    }

    if (!NPM_INSTALL_G_RE.test(line)) continue;

    // Só interessa quando o próprio npm é instalado (npm install -g npm@...).
    // Instalações globais de outros pacotes (ex.: runner-cli codex/droid) não têm
    // token npm@ e são ignoradas.
    const pins = [...line.matchAll(NPM_PIN_RE)];
    if (pins.length === 0) continue;

    for (const pin of pins) {
      const version = pin[1];
      if (version === "latest") {
        npmDriftFlagged = true;
        problems.push(
          `line ${lineNo}: npm@latest — pin to npm@${pinnedNpmVersion} for reproducible builds`
        );
      } else if (version !== pinnedNpmVersion) {
        npmDriftFlagged = true;
        problems.push(`line ${lineNo}: npm@${version} — expected pinned npm@${pinnedNpmVersion}`);
      } else {
        npmPinnedSeen = true;
      }
    }
  }

  // Guard RUN do Dockerfile deve conferir EXATAMENTE a versão da imagem pinada
  // (terceira cópia da verdade — cruzar aqui impede FROM/guard dessincronizados).
  if (nodePinnedSeen) {
    if (!guardVersion) {
      problems.push(
        `no Node version guard RUN (node --version | grep -qx "v...") found in the base stage`
      );
    } else if (guardVersion !== pinnedNodeVersion) {
      problems.push(
        `guard RUN checks node --version ${guardVersion} — expected ${pinnedNodeVersion} (pinned base image)`
      );
    }
  }

  // Resumo só quando o pin está AUSENTE por completo — se a linha errada já foi
  // sinalizada acima, o resumo seria ruído redundante.
  if (!nodePinnedSeen && !nodeDriftFlagged) {
    problems.push(`no FROM line uses the pinned base image ${pinnedNodeImage}`);
  }
  if (!npmPinnedSeen && !npmDriftFlagged) {
    problems.push(`no pinned npm@${pinnedNpmVersion} global install found`);
  }

  return problems;
}

function getDockerfilePath() {
  const i = process.argv.indexOf("--dockerfile");
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : DEFAULT_DOCKERFILE;
}

function main() {
  const dockerfilePath = getDockerfilePath();
  if (!fs.existsSync(dockerfilePath)) {
    console.error(`[check-dockerfile-pins] FAIL — ${dockerfilePath} não encontrado.`);
    process.exitCode = 2;
    return;
  }

  const lines = fs.readFileSync(dockerfilePath, "utf8").split(/\r?\n/);
  const problems = evaluateDockerfilePins(
    lines,
    PINNED_NODE_IMAGE,
    PINNED_NPM_VERSION,
    PINNED_NODE_VERSION
  );

  if (problems.length > 0) {
    console.error(
      `[check-dockerfile-pins] ${problems.length} drift(s) no Dockerfile:\n` +
        problems.map((p) => "  ✗ " + p).join("\n") +
        `\n  → atualize o Dockerfile (FROM + npm pin) E os pins em ` +
        `scripts/check/check-dockerfile-pins.mjs juntos.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-dockerfile-pins] OK — base ${PINNED_NODE_IMAGE}, npm@${PINNED_NPM_VERSION} pinned.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
