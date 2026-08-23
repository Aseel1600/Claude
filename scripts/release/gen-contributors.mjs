#!/usr/bin/env node
// Generate (or inject) the `### 🙌 Contributors` table for a CHANGELOG version section.
//
// WHY: every version's CHANGELOG `## [vX.Y.Z]` section MUST end with a `### 🙌 Contributors`
// table (the convention across every prior version). v3.8.43 shipped without it (a real miss the
// owner caught) because it was assembled by hand. This makes it reproducible + accurate.
//
// A naive `@handle` scan mis-assigns rollup PRs — a maintenance bullet lists many PRs under one
// `— thanks @X`, and a flat scan would credit every handle on the line with all of them. This
// parses each `([#refs] — thanks @X / @Y)` PARENTHETICAL GROUP and assigns that group's refs only
// to that group's handles (crediting is per-parenthetical, matching how bullets are written).
//
// Usage:
//   node scripts/release/gen-contributors.mjs <version>            # print the table
//   node scripts/release/gen-contributors.mjs <version> --inject   # insert/replace it in CHANGELOG.md
//
// Exit codes: 0 ok · 2 version section not found · 3 nothing to inject over.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Handles that are package names / code refs / scopes, never people. Extend as needed.
export const NOISE_HANDLES = new Set([
  "toon-format",
  "dnd-kit",
  "om-usage",
  "anthropic-ai",
  "huggingface",
  "oven",
  "latest",
  "next",
  "types",
]);

const MAINTAINER = "diegosouzapw";

/** Extract the `## [version]` … up to the next `## [` section body (exclusive of the next header). */
export function extractVersionSection(changelog, version) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`^## \\[${esc}\\][^\\n]*$`, "m");
  const sm = changelog.match(startRe);
  if (!sm) return null;
  const bodyStart = sm.index + sm[0].length;
  const rest = changelog.slice(bodyStart);
  const nextIdx = rest.search(/\n## \[/);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

/**
 * Parse contributor → set of ref numbers from a version section body.
 * Rules (in order, per bullet line starting with "- "):
 *  1. Parenthetical groups containing "thanks": refs in the group → handles in the group.
 *  2. A "thanks @X" NOT inside such a group (direct-commit trailing credit): the last ref before
 *     it on the line (if any) → the handles.
 *  3. "Extracted from [#N] by [@X]": N → X.
 * Excludes NOISE_HANDLES and the maintainer (returned separately by caller).
 */
export function parseContributors(sectionText) {
  const agg = new Map(); // handle -> Set(refs)
  const canonicalHandles = new Map(); // lower-case GitHub login -> displayed login
  const add = (handle, refs) => {
    const normalized = handle.toLowerCase();
    if (NOISE_HANDLES.has(normalized) || normalized === MAINTAINER) return;

    let canonical = canonicalHandles.get(normalized);
    if (!canonical) {
      canonical = handle;
      canonicalHandles.set(normalized, canonical);
      agg.set(canonical, new Set());
    } else if (canonical === normalized && handle !== normalized) {
      // GitHub logins are case-insensitive. Prefer a later cased spelling over an all-lowercase
      // occurrence while preserving every ref already collected for that account.
      const existingRefs = agg.get(canonical);
      agg.delete(canonical);
      canonical = handle;
      canonicalHandles.set(normalized, canonical);
      agg.set(canonical, existingRefs);
    }

    for (const r of refs) agg.get(canonical).add(r);
  };
  // A slash is a contributor separator only when another @handle follows it. This prevents
  // GitHub App identities such as `@app/dependabot` from being truncated and credited as `@app`.
  const handlesIn = (s) =>
    [...s.matchAll(/@([A-Za-z0-9_-]+)(?=$|[\s,;:.)\]}>]|\/\s*@)/g)].map((m) => m[1]);
  const refsIn = (s) => [...s.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

  for (const raw of sectionText.split("\n")) {
    if (!raw.startsWith("- ")) continue;
    // Collapse markdown links so parenthetical groups aren't broken by the URL's own parens:
    //   [#5720](https://…/pull/5720) → #5720   ·   [@pizzav-xyz](https://…) → @pizzav-xyz
    const line = raw
      .replace(/\[#(\d+)\]\([^)]*\)/g, "#$1")
      .replace(/\[@([A-Za-z0-9_-]+)\]\([^)]*\)/g, "@$1");
    const usedSpans = [];

    // (1) parenthetical groups with "thanks"
    for (const g of line.matchAll(/\(([^()]*thanks[^()]*)\)/g)) {
      const inner = g[1];
      const refs = refsIn(inner);
      for (const th of inner.matchAll(/thanks\s+((?:@[A-Za-z0-9_-]+(?:\s*\/\s*)?)+)/g)) {
        for (const h of handlesIn(th[1])) add(h, refs);
      }
      usedSpans.push([g.index, g.index + g[0].length]);
    }

    // (2) trailing "— thanks @X" outside any used parenthetical (direct commits)
    for (const th of line.matchAll(/thanks\s+((?:@[A-Za-z0-9_-]+(?:\s*\/\s*)?)+)/g)) {
      const inGroup = usedSpans.some(([s, e]) => th.index >= s && th.index < e);
      if (inGroup) continue;
      const before = line.slice(0, th.index);
      const refsBefore = refsIn(before);
      const refs = refsBefore.length ? [refsBefore[refsBefore.length - 1]] : [];
      for (const h of handlesIn(th[1])) add(h, refs);
    }

    // (3) "Extracted from #N by @X" (links already collapsed by the preprocessing above)
    for (const em of line.matchAll(
      /[Ee]xtracted from #(\d+)\s+by\s+@([A-Za-z0-9_-]+)(?![A-Za-z0-9_/-])/g
    )) {
      add(em[2], [Number(em[1])]);
    }
  }
  return agg;
}

export function renderContributors(version, agg, maintainerNote = "maintainer") {
  const fmt = (set) =>
    set.size
      ? [...set]
          .sort((a, b) => a - b)
          .map((n) => `#${n}`)
          .join(", ")
      : "direct commit / report";
  const rows = [...agg.entries()].sort((a, b) =>
    a[0].toLowerCase().localeCompare(b[0].toLowerCase())
  );
  const lines = [
    "### 🙌 Contributors",
    "",
    `Thanks to everyone whose work landed in v${version}:`,
    "",
    "| Contributor | PRs / Issues |",
    "| --- | --- |",
  ];
  for (const [h, refs] of rows) {
    lines.push(`| [@${h}](https://github.com/${h}) | ${fmt(refs)} |`);
  }
  lines.push(`| [@${MAINTAINER}](https://github.com/${MAINTAINER}) | ${maintainerNote} |`);
  return lines.join("\n");
}

/** Insert or replace the Contributors section inside the version block, before its closing `---`. */
export function injectContributors(changelog, version, table) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`^## \\[${esc}\\][^\\n]*$`, "m");
  const sm = changelog.match(startRe);
  if (!sm) return null;
  const headerEnd = sm.index + sm[0].length;
  const rest = changelog.slice(headerEnd);
  const nextIdx = rest.search(/\n## \[/);
  const bodyEnd = nextIdx === -1 ? changelog.length : headerEnd + nextIdx;
  let body = changelog.slice(headerEnd, bodyEnd);
  // Strip an existing Contributors section and its leading blank lines. Repeated injection must
  // be byte-idempotent instead of growing whitespace before the generated table on every run.
  body = body.replace(/\n+### 🙌 Contributors[\s\S]*?(?=\n---\n|$)/, "");
  // Insert before the trailing `---` (or append if none), with one blank line on each side.
  const idx = body.lastIndexOf("\n---");
  if (idx >= 0) {
    const prefix = body.slice(0, idx).replace(/\s+$/, "");
    body = `${prefix}\n\n${table}\n${body.slice(idx)}`;
  } else {
    body = `${body.replace(/\s+$/, "")}\n\n${table}\n\n---\n`;
  }
  return changelog.slice(0, headerEnd) + body + changelog.slice(bodyEnd);
}

function main(argv) {
  const version = argv[0];
  const inject = argv.includes("--inject");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    process.stderr.write("usage: gen-contributors.mjs <version> [--inject]\n");
    process.exit(1);
  }
  const clPath = path.join(ROOT, "CHANGELOG.md");
  const changelog = fs.readFileSync(clPath, "utf8");
  const section = extractVersionSection(changelog, version);
  if (section == null) {
    process.stderr.write(`No [${version}] section in CHANGELOG.md\n`);
    process.exit(2);
  }
  const agg = parseContributors(section);
  const table = renderContributors(version, agg);
  if (!inject) {
    process.stdout.write(table + "\n");
    return;
  }
  const next = injectContributors(changelog, version, table);
  if (next == null) {
    process.stderr.write(`Could not locate [${version}] block for injection\n`);
    process.exit(3);
  }
  fs.writeFileSync(clPath, next);
  process.stderr.write(`✓ Injected ${agg.size} external contributor(s) into [${version}]\n`);
}

// direct-run guard (importable for tests)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
