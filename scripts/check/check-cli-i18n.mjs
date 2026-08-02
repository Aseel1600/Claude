#!/usr/bin/env node
/**
 * Validates that:
 *   1. All t("key") calls in bin/cli/commands/ resolve to existing keys in en.json.
 *   2. pt-BR.json has the same top-level shape as en.json (no missing top-level sections).
 *   3. Maintained commands do not pass raw user-facing strings to
 *      .description(), .option(), .requiredOption(), or .argument().
 *      OpenAPI-generated commands are excluded from this check because their
 *      descriptions are generated from the API contract.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const COMMANDS_DIR = join(ROOT, "bin", "cli", "commands");
const TUI_DIRS = [join(ROOT, "bin", "cli", "tui"), join(ROOT, "bin", "cli", "tui-components")];
const LOCALES_DIR = join(ROOT, "bin", "cli", "locales");

// Paths that look like t() keys but are actually import paths — skip them.
const IGNORE_AS_KEY = new Set([".", ".."]);
const IMPORT_PATH_RE = /^(\.\.?\/|node:|\/)/;

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else if (entry.endsWith(".mjs") || entry.endsWith(".js") || entry.endsWith(".jsx")) {
      results.push(full);
    }
  }
  return results;
}

function flattenKeys(obj, prefix = "") {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const sub of flattenKeys(v, full)) keys.add(sub);
    } else {
      keys.add(full);
    }
  }
  return keys;
}

function collectTKeys(files) {
  const used = new Set();
  const re = /\bt\(\s*["']([^"']+)["']/g;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      const key = m[1];
      if (IGNORE_AS_KEY.has(key) || IMPORT_PATH_RE.test(key)) continue;
      used.add(key);
    }
  }
  return used;
}

function splitCallArguments(source, start) {
  const args = [];
  let segmentStart = start + 1;
  let depth = 1;
  let quote = null;
  let escaped = false;

  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(segmentStart, i));
        return { args, end: i };
      }
    } else if (char === "," && depth === 1) {
      args.push(source.slice(segmentStart, i));
      segmentStart = i + 1;
    }
  }
  return null;
}

function collectLiteralContractViolations(files) {
  const violations = [];
  const methods = ["description", "option", "requiredOption", "argument"];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const method of methods) {
      const callRe = new RegExp(`\\.${method}\\(`, "g");
      let match;
      while ((match = callRe.exec(source)) !== null) {
        const openParen = source.indexOf("(", match.index);
        const parsed = splitCallArguments(source, openParen);
        if (!parsed) continue;
        const first = parsed.args[0]?.trim() ?? "";
        const second = parsed.args[1]?.trim() ?? "";
        const line = source.slice(0, match.index).split("\n").length;
        const argument = method === "description" ? first : second;
        const isRawLiteral = /^["'`]/.test(argument);
        const isFallbackLiteral = method === "description" && /\|\|\s*["'`]/.test(first);
        if (isRawLiteral || isFallbackLiteral) {
          violations.push(`${file}:${line} .${method}() must use t()`);
        }
        callRe.lastIndex = parsed.end + 1;
      }
    }
  }
  return violations;
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const files = walk(COMMANDS_DIR);
const maintainedCommandFiles = files.filter(
  (file) => !file.includes(`${join("bin", "cli", "commands", "api-commands")}`)
);
const usedKeys = collectTKeys([...files, ...TUI_DIRS.flatMap((dir) => walk(dir))]);
const en = loadJson(join(LOCALES_DIR, "en.json"));
const ptBR = loadJson(join(LOCALES_DIR, "pt-BR.json"));
const enKeys = flattenKeys(en);

let errors = 0;

// Check 1: all used keys exist in en.json
const missingInEn = [...usedKeys].filter((k) => !enKeys.has(k));
if (missingInEn.length > 0) {
  console.error("[cli-i18n] Keys used in commands but missing in en.json:");
  for (const k of missingInEn) console.error(`  ✗ ${k}`);
  errors += missingInEn.length;
} else {
  console.log(`[cli-i18n] ✓ All ${usedKeys.size} t() keys found in en.json`);
}

// Check 2: pt-BR.json has the same top-level sections as en.json
const enTopLevel = Object.keys(en);
const ptTopLevel = new Set(Object.keys(ptBR));
const missingTopLevel = enTopLevel.filter((k) => !ptTopLevel.has(k));
if (missingTopLevel.length > 0) {
  console.error("[cli-i18n] Top-level sections in en.json missing from pt-BR.json:");
  for (const k of missingTopLevel) console.error(`  ✗ ${k}`);
  errors += missingTopLevel.length;
} else {
  console.log(`[cli-i18n] ✓ pt-BR.json has all ${enTopLevel.length} top-level sections`);
}

// Check 3: maintained command contracts must be localized. Generated API
// command files are intentionally excluded above.
const literalContractViolations = collectLiteralContractViolations(maintainedCommandFiles);
if (literalContractViolations.length > 0) {
  console.error("[cli-i18n] User-facing command contracts contain raw literals:");
  for (const violation of literalContractViolations) console.error(`  ✗ ${violation}`);
  errors += literalContractViolations.length;
} else {
  console.log(
    `[cli-i18n] ✓ Maintained command descriptions/options/arguments use t() (${maintainedCommandFiles.length} files)`
  );
}

if (errors > 0) {
  console.error(`[cli-i18n] FAIL — ${errors} error(s) found`);
  process.exit(1);
} else {
  console.log("[cli-i18n] PASS — CLI i18n is consistent");
}
