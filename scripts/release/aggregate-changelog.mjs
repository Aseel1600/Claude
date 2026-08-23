#!/usr/bin/env node
// scripts/release/aggregate-changelog.mjs
//
// Changelog FRAGMENTS aggregator (towncrier/changesets pattern, adopted 2026-07-09).
//
// Why: during a release cycle every PR used to edit the same few lines at the top of
// CHANGELOG.md (its bullet). In a merge-storm each merge conflicted every sibling
// (CHANGELOG-eat / DIRTY cascade), forcing a re-sync push + full CI re-run per PR per
// merge — O(N²) CI runs for N queued PRs. With fragments, a PR adds ONE NEW FILE under
// changelog.d/<section>/ instead, so two PRs never touch the same file: no conflicts,
// no eat, no re-sync. This script is the single place fragments become CHANGELOG.md
// bullets — run by the release captain (or /generate-release) at reconciliation, and
// safe to run mid-cycle whenever a consolidated view is wanted.
//
// Convention:
//   changelog.d/features/<PR>-<slug>.md     → appended to "### ✨ New Features"
//   changelog.d/fixes/<PR>-<slug>.md        → appended to "### 🐛 Bug Fixes"
//   changelog.d/maintenance/<PR>-<slug>.md  → appended to "### 📝 Maintenance"
//   File content = the exact bullet line(s), starting with "- " (continuation lines
//   allowed). Credit format stays the repo norm: "(#PR — thanks @user)".
//
// Usage:
//   node scripts/release/aggregate-changelog.mjs --version <version> [--dry-run]
//     --version  exact CHANGELOG release section to update (for example, 3.8.50);
//     --dry-run  print the would-be CHANGELOG.md to stdout and list fragments;
//                touch nothing.
//
// On a real run, aggregated fragment files are DELETED (leaving README.md and the
// .gitkeep placeholders) — the caller commits both the CHANGELOG.md update and the
// deletions in one commit.

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FRAGMENTS_DIR = "changelog.d";

/** Section subdir → the CHANGELOG heading its bullets are appended under. */
export const SECTIONS = Object.freeze({
  features: "### ✨ New Features",
  fixes: "### 🐛 Bug Fixes",
  maintenance: "### 📝 Maintenance",
});

const SKIP_FILES = new Set(["README.md", ".gitkeep"]);

function assertTargetVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('target version is required (for example, { version: "3.8.50" })');
  }
}

/**
 * Validate one fragment's text. Returns null when OK, or a human-readable error.
 * Pure — unit-tested.
 */
export function validateFragmentText(text) {
  const body = String(text || "").replace(/^﻿/, "");
  const lines = body.split("\n");
  const firstContent = lines.find((l) => l.trim().length > 0);
  if (!firstContent) return "empty fragment";
  if (!firstContent.trimStart().startsWith("- ")) {
    return 'fragment must start with a markdown bullet ("- ")';
  }
  if (/^(<{7}|={7}|>{7})/m.test(body)) return "fragment contains merge-conflict markers";
  if (/#(?:PRNUM|PENDING)\b|\/pull\/(?:PRNUM|PENDING)(?:[/?#)]|$)/i.test(body)) {
    return "fragment contains an unresolved PR placeholder";
  }
  for (const match of body.matchAll(
    /\[([^\]\n]+)\]\(https:\/\/github\.com\/diegosouzapw\/OmniRoute\/pull\/(\d+)\/?(?:[?#][^)]*)?\)/g
  )) {
    const expected = `#${match[2]}`;
    if (match[1].trim() !== expected) return `pull link label must be "${expected}"`;
  }
  return null;
}

/**
 * Collect fragments from <root>/changelog.d, sorted by filename per section for a
 * deterministic output order. Returns { features: [...], fixes: [...],
 * maintenance: [...], invalid: [{file, error}] } where each valid entry is
 * { file, text } (text trimmed of trailing whitespace).
 */
export function collectFragments(root) {
  const out = { features: [], fixes: [], maintenance: [], invalid: [] };
  const base = join(root, FRAGMENTS_DIR);
  if (!existsSync(base)) return out;
  for (const section of Object.keys(SECTIONS)) {
    const dir = join(base, section);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !SKIP_FILES.has(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const f of files) {
      const file = join(dir, f);
      const text = readFileSync(file, "utf8").replace(/\s+$/, "");
      const error = validateFragmentText(text);
      if (error) out.invalid.push({ file: relative(root, file), error });
      else out[section].push({ file: relative(root, file), text });
    }
  }
  return out;
}

/**
 * Append bullets at the END of a target version's section-heading blocks. Pure — unit-tested.
 * The version is mandatory because Unreleased and released sections intentionally reuse the
 * same headings.
 */
export function insertBullets(changelogText, bulletsBySection, { version } = {}) {
  assertTargetVersion(version);

  let lines = changelogText.split("\n");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const targetHeading = new RegExp(`^## \\[${escapedVersion}\\](?:\\s|$)`);
  const targetMatches = lines.flatMap((line, index) => (targetHeading.test(line) ? [index] : []));
  if (targetMatches.length === 0) {
    throw new Error(`target version [${version}] not found in CHANGELOG.md`);
  }
  if (targetMatches.length > 1) {
    throw new Error(`target version [${version}] appears ${targetMatches.length} times`);
  }

  const targetStart = targetMatches[0];
  let targetEnd = lines.findIndex((line, index) => index > targetStart && /^##\s/.test(line));
  if (targetEnd === -1) targetEnd = lines.length;

  const insertions = [];
  const targetBody = `\n${lines
    .slice(targetStart + 1, targetEnd)
    .join("\n")
    .trimEnd()}\n`;
  const seenFragmentText = new Map();
  for (const [section, heading] of Object.entries(SECTIONS)) {
    const entries = bulletsBySection[section] || [];
    const bullets = entries.map((entry) => {
      const text = String(entry.text ?? entry).trimEnd();
      const file = entry.file || `${section} fragment`;
      const firstFile = seenFragmentText.get(text);
      if (firstFile) {
        throw new Error(`duplicate fragment content in ${firstFile} and ${file}`);
      }
      seenFragmentText.set(text, file);
      if (targetBody.includes(`\n${text}\n`)) {
        throw new Error(`fragment content is already present in [${version}]: ${file}`);
      }
      return text;
    });
    if (bullets.length === 0) continue;
    const headingMatches = lines.flatMap((line, index) =>
      index > targetStart && index < targetEnd && line.trim() === heading ? [index] : []
    );
    if (headingMatches.length === 0) {
      throw new Error(
        `heading "${heading}" not found inside target version [${version}] before aggregating ${section} fragments`
      );
    }
    if (headingMatches.length > 1) {
      throw new Error(
        `heading "${heading}" appears ${headingMatches.length} times inside target version [${version}]`
      );
    }
    insertions.push({ headIdx: headingMatches[0], bullets });
  }

  // Work from the bottom up so earlier insertions cannot invalidate later section indexes.
  for (const { headIdx, bullets } of insertions.sort((a, b) => b.headIdx - a.headIdx)) {
    // End of this section's block: last non-empty line before the next heading.
    let nextHead = targetEnd;
    for (let i = headIdx + 1; i < targetEnd; i++) {
      if (/^#{2,3}\s/.test(lines[i])) {
        nextHead = i;
        break;
      }
    }
    let insertAt = nextHead;
    while (insertAt > headIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
    const block = bullets.flatMap((b) => b.split("\n"));
    lines = [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)];
  }
  return lines.join("\n");
}

/**
 * Aggregate fragments into CHANGELOG.md. Returns a summary object. When dryRun is
 * true nothing is written or deleted.
 */
export function aggregate({ root = ROOT, version, dryRun = false } = {}) {
  assertTargetVersion(version);
  const collected = collectFragments(root);
  if (collected.invalid.length > 0) {
    const detail = collected.invalid.map((i) => `  ✗ ${i.file}: ${i.error}`).join("\n");
    throw new Error(`invalid changelog fragments:\n${detail}`);
  }
  const total = collected.features.length + collected.fixes.length + collected.maintenance.length;
  const changelogPath = join(root, "CHANGELOG.md");
  const before = readFileSync(changelogPath, "utf8");
  const after = insertBullets(before, collected, { version });
  if (!dryRun && total > 0) {
    writeFileSync(changelogPath, after);
    for (const section of Object.keys(SECTIONS)) {
      for (const { file } of collected[section]) unlinkSync(join(root, file));
    }
  }
  return { total, collected, changed: total > 0, after };
}

function parseCliArgs(argv) {
  let version;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--version") {
      if (version !== undefined) throw new Error("--version may only be provided once");
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error("--version <version> is required");
      }
      version = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!version) throw new Error("--version <version> is required");
  return { version, dryRun };
}

export function main(
  argv = process.argv.slice(2),
  { root = ROOT, stdout = process.stdout, stderr = process.stderr } = {}
) {
  let args;
  let result;
  try {
    args = parseCliArgs(argv);
    result = aggregate({ root, ...args });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`[aggregate-changelog] error: ${message}\n`);
    return 2;
  }

  const log = args.dryRun ? stderr : stdout;
  if (args.dryRun) {
    stdout.write(result.after);
    if (!result.after.endsWith("\n")) stdout.write("\n");
  }
  if (result.total === 0) {
    log.write("[aggregate-changelog] no fragments to aggregate — nothing to do.\n");
    return 0;
  }
  for (const section of Object.keys(SECTIONS)) {
    for (const { file } of result.collected[section]) {
      log.write(
        `[aggregate-changelog] ${args.dryRun ? "would aggregate" : "aggregated"} ${file}\n`
      );
    }
  }
  log.write(
    `[aggregate-changelog] ${result.total} fragment(s) → CHANGELOG.md${args.dryRun ? " (dry-run, nothing written)" : " (fragments deleted — commit CHANGELOG.md + deletions together)"}\n`
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
