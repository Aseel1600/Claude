import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateDockerfilePins,
  PINNED_NODE_IMAGE,
  PINNED_NODE_VERSION,
  PINNED_NPM_VERSION,
} from "../../../scripts/check/check-dockerfile-pins.mjs";

// Wrapper local — o gate cruza imagem base + npm + guard RUN.
const evalPins = (lines: string[]) =>
  evaluateDockerfilePins(lines, PINNED_NODE_IMAGE, PINNED_NPM_VERSION, PINNED_NODE_VERSION);

// A "good" Dockerfile fragment — mirrors the pinned base + guard RUN + npm install.
const GOOD_LINES = [
  "FROM node:22.23.1-bookworm-slim AS base",
  "WORKDIR /app",
  'RUN node --version | grep -qx "v22.23.1" \\',
  '  || { echo "drift" >&2; exit 1; }',
  "RUN npm install -g npm@11.19.0 \\",
  "  && npm cache clean --force",
];

test("clean pinned Dockerfile has no problems", () => {
  assert.deepEqual(evalPins(GOOD_LINES), []);
});

test("flags a floating base image tag (node:22)", () => {
  const lines = GOOD_LINES.map((l) => l.replace(PINNED_NODE_IMAGE, "node:22"));
  const problems = evalPins(lines);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /FROM node:22/);
  assert.match(problems[0], /line 1/);
});

test("flags a drifted minor/patch Node version", () => {
  const lines = GOOD_LINES.map((l) => l.replace(PINNED_NODE_IMAGE, "node:22.23.3-bookworm-slim"));
  const problems = evalPins(lines);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /node:22\.23\.3-bookworm-slim/);
});

test("flags npm@latest", () => {
  const lines = GOOD_LINES.map((l) => l.replace("npm@11.19.0", "npm@latest"));
  const problems = evalPins(lines);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /npm@latest/);
});

test("flags an unpinned npm version", () => {
  const lines = GOOD_LINES.map((l) => l.replace("npm@11.19.0", "npm@13.0.0"));
  const problems = evalPins(lines);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /npm@13\.0\.0/);
});

test("flags a guard RUN whose version no longer matches the pinned base image", () => {
  const lines = GOOD_LINES.map((l) => l.replace('grep -qx "v22.23.1"', 'grep -qx "v22.23.3"'));
  const problems = evalPins(lines);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /guard RUN checks node --version v22\.23\.3/);
});

test("flags a missing guard RUN entirely", () => {
  const lines = GOOD_LINES.filter((l) => !l.includes("node --version"));
  const problems = evalPins(lines);
  assert.ok(problems.some((p) => /no Node version guard RUN/.test(p)));
});

test("ignores non-npm global installs (runner-cli stage)", () => {
  const lines = [
    ...GOOD_LINES,
    "RUN npm install -g --no-audit --no-fund @openai/codex @anthropic-ai/claude-code droid",
  ];
  assert.deepEqual(evalPins(lines), []);
});

test("flags a missing base-image pin entirely", () => {
  const lines = GOOD_LINES.filter((l) => !l.startsWith("FROM"));
  const problems = evalPins(lines);
  assert.ok(problems.some((p) => /no FROM line uses/.test(p)));
});

test("flags a missing npm pin entirely", () => {
  const lines = GOOD_LINES.filter((l) => !l.includes("npm install -g"));
  const problems = evalPins(lines);
  assert.ok(problems.some((p) => /no pinned npm@/.test(p)));
});

test("non-node base images (stage aliases) are ignored", () => {
  const lines = ["FROM base AS runner-web", "FROM scratch", ...GOOD_LINES];
  assert.deepEqual(evalPins(lines), []);
});

test("the real Dockerfile is green under the pinned constants", () => {
  const dockerfilePath = path.resolve(import.meta.dirname, "../../../Dockerfile");
  assert.ok(fs.existsSync(dockerfilePath), "expected Dockerfile to exist");
  const lines = fs.readFileSync(dockerfilePath, "utf8").split(/\r?\n/);
  const problems = evalPins(lines);
  assert.deepEqual(problems, [], `real Dockerfile drifted: ${problems.join("; ")}`);
});
