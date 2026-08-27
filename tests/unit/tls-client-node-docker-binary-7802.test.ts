import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

test("Dockerfile's --ignore-scripts npm ci is compensated for tls-client-node's native binary, same as it is for wreq-js and better-sqlite3 (#7802)", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const postinstall = readFileSync(join(ROOT, "scripts/build/postinstall.mjs"), "utf8");

  assert.match(
    dockerfile,
    // Flag-order tolerant on purpose: the assertion is about the --ignore-scripts
    // PRECONDITION, not the exact flag list. #9185 inserted --include=optional
    // (LLMLingua optional deps) and broke the literal pin without touching intent.
    /npm ci(?: --[\w-]+(?:=[\w-]+)?)* --ignore-scripts/,
    "expected the builder stage to install with --ignore-scripts (precondition of #7802)"
  );

  assert.match(
    dockerfile,
    /better-sqlite3[\s\S]*node-gyp\.js rebuild/,
    "expected an explicit better-sqlite3 rebuild step after --ignore-scripts"
  );

  assert.match(
    postinstall,
    /fixWreqJsBinary/,
    "expected postinstall.mjs to repair wreq-js's native binary"
  );

  assert.match(
    dockerfile,
    /COPY scripts\/build\/fixTlsClientNodeBinary\.mjs \.\/scripts\/build\/fixTlsClientNodeBinary\.mjs/,
    "Docker builder must copy the checksum-verifying repair helper"
  );
  assert.match(
    dockerfile,
    /COPY open-sse\/config\/tlsClientNativeManifest\.json \.\/open-sse\/config\/tlsClientNativeManifest\.json/,
    "Docker builder must copy the pinned version and official SHA-256 manifest"
  );
  assert.match(
    dockerfile,
    /node scripts\/build\/fixTlsClientNodeBinary\.mjs --strict/,
    "Docker build must fail closed when the pinned native binary is absent or unverified"
  );
  assert.doesNotMatch(
    dockerfile,
    /node node_modules\/tls-client-node\/scripts\/postinstall\.js/,
    "Docker must not bypass checksum verification by invoking the upstream downloader directly"
  );

  const dockerfileHandlesIt = /tls-client-node[\s\S]{0,200}(postinstall|rebuild|download)/i.test(
    dockerfile
  );
  const postinstallHandlesIt = /tls-client-node/i.test(postinstall);

  assert.ok(
    dockerfileHandlesIt || postinstallHandlesIt,
    "tls-client-node has no --ignore-scripts compensation in Dockerfile or " +
      "scripts/build/postinstall.mjs (unlike better-sqlite3 and wreq-js) — " +
      "node_modules/tls-client-node/bin/ is never populated in the official " +
      "Docker image, so chatgpt-web/claude-web/grok-web/lmarena/perplexity-web " +
      "all fail with TlsClientUnavailableError at first request (#7802)"
  );
});
