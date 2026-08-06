import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import {
  computeDependencyClosure,
  colocateLlmlinguaOptionals,
  SEED_PACKAGES,
} from "../../scripts/build/colocateOptionals.mjs";

/** Create a fake installed package with a manifest and optional extra files. */
function mkPkg(
  nmDir: string,
  name: string,
  manifest: Record<string, unknown> = {},
  files: Record<string, string> = {}
): void {
  const dir = join(nmDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
  for (const [rel, content] of Object.entries(files)) {
    const fp = join(dir, rel);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, content);
  }
  // Real packages always have a resolvable entry; the completeness check uses
  // require.resolve, so a main-less stub would be re-copied on every run.
  const main = (manifest.main as string) || "index.js";
  const mainPath = join(dir, main);
  if (!existsSync(mainPath)) {
    mkdirSync(dirname(mainPath), { recursive: true });
    writeFileSync(mainPath, "module.exports = {};\n");
  }
}

/**
 * Build a root tree mirroring the real SLM optional shape:
 *   @atjsh/llmlingua-2 → dep es-toolkit, PEER @huggingface/transformers (+ tfjs, js-tiktoken)
 *   @tensorflow/tfjs   → dep @tensorflow/tfjs-core → dep long
 *   js-tiktoken        → dep base64-js
 *   @huggingface/transformers present at root as a (stale) 4.2.0
 */
function buildRoot(rootDir: string): void {
  const rootNm = join(rootDir, "node_modules");
  mkPkg(
    rootNm,
    "@atjsh/llmlingua-2",
    {
      dependencies: { "es-toolkit": "^1.38.0" },
      peerDependencies: {
        "@huggingface/transformers": "*",
        "@tensorflow/tfjs": "*",
        "js-tiktoken": "*",
      },
    },
    { "dist/index.js": "export const llmlingua = true;\n" }
  );
  mkPkg(rootNm, "es-toolkit", {});
  mkPkg(rootNm, "@tensorflow/tfjs", { dependencies: { "@tensorflow/tfjs-core": "4.22.0" } });
  mkPkg(rootNm, "@tensorflow/tfjs-core", { dependencies: { long: "^5.0.0" } });
  mkPkg(rootNm, "long", {});
  mkPkg(rootNm, "js-tiktoken", { dependencies: { "base64-js": "^1.5.1" } });
  mkPkg(rootNm, "base64-js", {});
  // Root transformers is the STALE 4.x line — the bug we must not propagate into dist.
  mkPkg(rootNm, "@huggingface/transformers", { version: "4.2.0" });
}

test("computeDependencyClosure walks deps transitively and skips peers (transformers)", () => {
  const root = mkdtempSync(join(tmpdir(), "omniroute-colocate-closure-"));
  try {
    buildRoot(root);
    const closure = computeDependencyClosure(join(root, "node_modules"));

    for (const expected of [
      "@atjsh/llmlingua-2",
      "@tensorflow/tfjs",
      "js-tiktoken",
      "es-toolkit",
      "@tensorflow/tfjs-core",
      "long",
      "base64-js",
    ]) {
      assert.ok(closure.includes(expected), `closure should include ${expected}`);
    }
    // The peer (declared via peerDependencies, NOT dependencies) must NOT be pulled in.
    assert.ok(
      !closure.includes("@huggingface/transformers"),
      "closure must NOT include the transformers peer"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("colocateLlmlinguaOptionals copies the closure into dist and never clobbers dist transformers", () => {
  const root = mkdtempSync(join(tmpdir(), "omniroute-colocate-copy-"));
  try {
    buildRoot(root);
    // dist already ships the PINNED transformers (3.5.2) — must survive untouched.
    const distNm = join(root, "dist", "node_modules");
    mkPkg(distNm, "@huggingface/transformers", { version: "3.5.2" });

    const result = colocateLlmlinguaOptionals({ rootDir: root });
    assert.equal(result.skipped, false);
    if (result.skipped === false) {
      assert.ok(result.copied >= 6, `expected >=6 packages copied, got ${result.copied}`);
    }

    // Full closure landed in dist/node_modules.
    for (const name of [
      "@atjsh/llmlingua-2",
      "es-toolkit",
      "@tensorflow/tfjs",
      "@tensorflow/tfjs-core",
      "long",
      "js-tiktoken",
      "base64-js",
    ]) {
      assert.ok(existsSync(join(distNm, name)), `${name} should be co-located into dist`);
    }
    // The package payload came along (not just the manifest).
    assert.ok(existsSync(join(distNm, "@atjsh", "llmlingua-2", "dist", "index.js")));

    // CRITICAL: dist's pinned transformers is preserved — root's 4.2.0 must NOT win.
    const distTransformers = JSON.parse(
      readFileSync(join(distNm, "@huggingface", "transformers", "package.json"), "utf8")
    );
    assert.equal(distTransformers.version, "3.5.2", "dist transformers must remain 3.5.2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("colocateLlmlinguaOptionals is idempotent (second run is a no-op)", () => {
  const root = mkdtempSync(join(tmpdir(), "omniroute-colocate-idem-"));
  try {
    buildRoot(root);
    mkPkg(join(root, "dist", "node_modules"), "@huggingface/transformers", { version: "3.5.2" });

    const first = colocateLlmlinguaOptionals({ rootDir: root });
    assert.equal(first.skipped, false);

    const second = colocateLlmlinguaOptionals({ rootDir: root });
    assert.equal(second.skipped, true);
    if (second.skipped === true) {
      assert.equal(second.reason, "already co-located");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("colocateLlmlinguaOptionals skips when SLM optionals are not installed", () => {
  const root = mkdtempSync(join(tmpdir(), "omniroute-colocate-noopt-"));
  try {
    // dist bundle exists, but the optional seeds were never installed at root.
    mkPkg(join(root, "dist", "node_modules"), "@huggingface/transformers", { version: "3.5.2" });
    mkdirSync(join(root, "node_modules"), { recursive: true });

    const result = colocateLlmlinguaOptionals({ rootDir: root });
    assert.equal(result.skipped, true);
    if (result.skipped === true) {
      assert.equal(result.reason, "SLM optionals not installed at root");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("colocateLlmlinguaOptionals skips when there is no standalone dist bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "omniroute-colocate-nodist-"));
  try {
    buildRoot(root); // optionals present, but no dist/node_modules
    const result = colocateLlmlinguaOptionals({ rootDir: root });
    assert.equal(result.skipped, true);
    if (result.skipped === true) {
      assert.equal(result.reason, "no standalone dist/node_modules");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SEED_PACKAGES excludes transformers (it is a dist-pinned peer, not a seed)", () => {
  assert.ok(!SEED_PACKAGES.includes("@huggingface/transformers"));
  assert.deepEqual(SEED_PACKAGES, ["@atjsh/llmlingua-2", "@tensorflow/tfjs", "js-tiktoken"]);
});

test("onnxruntime-node partial trace (JS only) is re-copied with its native binding", () => {
  const root = mkdtempSync(join(tmpdir(), "omniroute-colocate-native-"));
  try {
    const rootNm = join(root, "node_modules");
    const nativeRel = join(
      "bin",
      "napi-v3",
      process.platform,
      process.arch,
      "onnxruntime_binding.node"
    );
    // Full source packages: seeds + transformers (which OPTIONALLY pulls onnxruntime-node).
    mkPkg(rootNm, "@atjsh/llmlingua-2", {}, { "dist/index.js": "export const l2 = true;\n" });
    mkPkg(rootNm, "@tensorflow/tfjs", {}, { "dist/tf.js": "export const tf = true;\n" });
    mkPkg(rootNm, "js-tiktoken", {}, { "dist/token.js": "export const tk = true;\n" });
    mkPkg(
      rootNm,
      "@huggingface/transformers",
      { optionalDependencies: { "onnxruntime-node": "1.20.0", "onnxruntime-web": "1.20.0" } },
      { "dist/transformers.js": "export const tx = true;\n" }
    );
    mkPkg(
      rootNm,
      "onnxruntime-node",
      { main: "dist/binding.js", version: "1.20.0" },
      {
        "dist/binding.js": "module.exports = { binding: true };\n",
        [nativeRel]: "not a real .node, just presence",
      }
    );
    mkPkg(
      rootNm,
      "onnxruntime-web",
      { main: "dist/web.js" },
      { "dist/web.js": "export const web = true;\n" }
    );

    // dist ships the PINNED transformers (3.5.2) plus a Next.js-style PARTIAL
    // onnxruntime-node trace: package.json + JS present, native bin/ MISSING.
    const distNm = join(root, "dist", "node_modules");
    mkPkg(distNm, "@huggingface/transformers", { version: "3.5.2" });
    mkPkg(
      distNm,
      "onnxruntime-node",
      { main: "dist/binding.js", version: "1.20.0" },
      { "dist/binding.js": "module.exports = { binding: true };\n" }
    );

    const result = colocateLlmlinguaOptionals({
      rootDir: root,
      seeds: [...SEED_PACKAGES, "@huggingface/transformers"],
    });
    assert.equal(result.skipped, false);
    if (result.skipped === false) {
      assert.ok(result.copied >= 1, `expected onnxruntime-node copied, got ${result.copied}`);
    }

    // The native binding must have landed despite the resolving partial trace.
    assert.ok(
      existsSync(join(distNm, "onnxruntime-node", nativeRel)),
      "onnxruntime-node native binding must be co-located (dlopen needs it)"
    );
    // dist transformers remains the pinned instance.
    const distTransformers = JSON.parse(
      readFileSync(join(distNm, "@huggingface", "transformers", "package.json"), "utf8")
    );
    assert.equal(distTransformers.version, "3.5.2");

    // Once complete (native present), a rerun is a no-op.
    const second = colocateLlmlinguaOptionals({
      rootDir: root,
      seeds: [...SEED_PACKAGES, "@huggingface/transformers"],
    });
    assert.equal(second.skipped, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
