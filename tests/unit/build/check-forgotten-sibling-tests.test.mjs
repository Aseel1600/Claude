// tests/unit/build/check-forgotten-sibling-tests.test.mjs
// TDD tests for the forgotten-sibling-tests gate (check-forgotten-sibling-tests.mjs).

import assert from "node:assert";
import { describe, it } from "node:test";

import {
  testSiblingOf,
  isAllowlisted,
  isSourceFile,
  resolveBase,
  findConsumers,
} from "../../../scripts/check/check-forgotten-sibling-tests.mjs";
import { ROOT } from "../../../scripts/check/lib/importResolution.mjs";

describe("check-forgotten-sibling-tests", () => {
  describe("isSourceFile", () => {
    it("returns true for src/ .ts files", () => {
      assert.strictEqual(isSourceFile("src/lib/foo.ts"), true);
    });
    it("returns true for open-sse/ files", () => {
      assert.strictEqual(isSourceFile("open-sse/services/foo.ts"), true);
    });
    it("returns true for bin/ files", () => {
      assert.strictEqual(isSourceFile("bin/cli.ts"), true);
    });
    it("returns false for test files under tests/", () => {
      assert.strictEqual(isSourceFile("tests/unit/foo.test.ts"), false);
    });
    it("returns false for migration files", () => {
      assert.strictEqual(isSourceFile("src/lib/db/migrations/001.sql"), false);
    });
    it("returns false for node_modules", () => {
      assert.strictEqual(isSourceFile("node_modules/foo/index.ts"), false);
    });
    it("returns false for markdown files", () => {
      assert.strictEqual(isSourceFile("docs/readme.md"), false);
    });
  });

  describe("resolveBase", () => {
    it("returns GITHUB_BASE_SHA when set", () => {
      const prev = process.env.GITHUB_BASE_SHA;
      process.env.GITHUB_BASE_SHA = "abc123";
      assert.strictEqual(resolveBase(), "abc123");
      process.env.GITHUB_BASE_SHA = prev;
    });
    it("returns origin/REF when only GITHUB_BASE_REF is set", () => {
      const prev = process.env.GITHUB_BASE_REF;
      delete process.env.GITHUB_BASE_SHA;
      process.env.GITHUB_BASE_REF = "release/v3.8.50";
      assert.strictEqual(resolveBase(), "origin/release/v3.8.50");
      process.env.GITHUB_BASE_REF = prev;
    });
    it("returns null when neither env var is set", () => {
      const prevSha = process.env.GITHUB_BASE_SHA;
      const prevRef = process.env.GITHUB_BASE_REF;
      delete process.env.GITHUB_BASE_SHA;
      delete process.env.GITHUB_BASE_REF;
      assert.strictEqual(resolveBase(), null);
      process.env.GITHUB_BASE_SHA = prevSha;
      process.env.GITHUB_BASE_REF = prevRef;
    });
  });

  describe("testSiblingOf", () => {
    it("returns null for a file that has no test sibling", () => {
      const result = testSiblingOf("src/lib/db/core.ts");
      assert.strictEqual(result, null);
    });
  });

  describe("isAllowlisted", () => {
    const allowlist = [
      {
        sourcePath: "src/lib/example.ts",
        forgottenSibling: "tests/unit/lib/consumer.test.ts",
        reason: "test",
      },
      {
        sourcePath: "*",
        forgottenSibling: "tests/unit/lib/wildcard.test.ts",
        reason: "wildcard test",
      },
    ];
    it("returns true for exact match", () => {
      assert.strictEqual(
        isAllowlisted("src/lib/example.ts", "tests/unit/lib/consumer.test.ts", allowlist),
        true
      );
    });
    it("returns true for wildcard sourcePath", () => {
      assert.strictEqual(
        isAllowlisted("src/lib/other.ts", "tests/unit/lib/wildcard.test.ts", allowlist),
        true
      );
    });
    it("returns false for non-allowlisted pair", () => {
      assert.strictEqual(
        isAllowlisted("src/lib/example.ts", "tests/unit/lib/other.test.ts", allowlist),
        false
      );
    });
    it("returns false for empty allowlist", () => {
      assert.strictEqual(
        isAllowlisted("src/lib/example.ts", "tests/unit/lib/consumer.test.ts", []),
        false
      );
    });
  });

  describe("findConsumers", () => {
    it("returns consumers that import the given file", () => {
      const absPath = ROOT + "/src/lib/target.ts";
      const prodFileMap = {
        "src/lib/consumer.ts": new Set([absPath]),
        "src/lib/unrelated.ts": new Set(["/other/path.ts"]),
      };
      const result = findConsumers("src/lib/target.ts", prodFileMap);
      assert.deepStrictEqual(result, ["src/lib/consumer.ts"]);
    });
    it("returns empty array when no consumers import the file", () => {
      const prodFileMap = {
        "src/lib/consumer.ts": new Set([ROOT + "/src/lib/other.ts"]),
      };
      const result = findConsumers("src/lib/target.ts", prodFileMap);
      assert.deepStrictEqual(result, []);
    });
  });
});
