/**
 * The shipped VSIX declares its version TWICE, and VS Code reads the one most
 * people forget.
 *
 * `extension/package.json` carries `version`; `extension.vsixmanifest` carries
 * `<Identity ... Version="...">`. VS Code installs from the vsixmanifest, so a
 * bump applied to package.json alone produces a package that still looks like the
 * old version to the editor — the install is refused as "already installed", or
 * lands showing the wrong version. Caught exactly that way on the 0.3.2 -> 0.3.3
 * bump (2026-08-09): package.json said 0.3.3, the vsixmanifest still said 0.3.2.
 *
 * The extension is shipped as a prebuilt artifact — there is no source tree to
 * rebuild it from — so every version change is a manual edit of both files. This
 * test is the only thing standing between such an edit and a package that will
 * not install.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const VSIX_PATH = path.join(process.cwd(), "public", "extension", "ia-one.vsix");
const SEMVER = /^\d+\.\d+\.\d+$/;

function readVsixEntries() {
  return unzipSync(new Uint8Array(fs.readFileSync(VSIX_PATH)));
}

test("the shipped VSIX exists and is a readable archive", () => {
  assert.ok(fs.existsSync(VSIX_PATH), `expected the packaged extension at ${VSIX_PATH}`);
  const entries = readVsixEntries();
  for (const required of ["[Content_Types].xml", "extension.vsixmanifest", "extension/package.json"]) {
    assert.ok(entries[required], `a VSIX must contain ${required}`);
  }
});

test("package.json and extension.vsixmanifest declare the SAME version", () => {
  const entries = readVsixEntries();
  const manifestVersion = JSON.parse(strFromU8(entries["extension/package.json"])).version;
  const identity = strFromU8(entries["extension.vsixmanifest"]).match(/<Identity\b[^>]*>/)?.[0];

  assert.ok(identity, "extension.vsixmanifest must carry an <Identity> element");
  const vsixVersion = identity.match(/\bVersion="([^"]*)"/)?.[1];

  assert.match(String(manifestVersion), SEMVER, "package.json version must be semver");
  assert.match(String(vsixVersion), SEMVER, "vsixmanifest Version must be semver");
  assert.equal(
    vsixVersion,
    manifestVersion,
    `VS Code installs from the vsixmanifest — it says ${vsixVersion} while package.json says ${manifestVersion}, so the package would install as the wrong version (or be refused)`
  );
});

test("the publisher and id agree across both manifests", () => {
  const entries = readVsixEntries();
  const pkg = JSON.parse(strFromU8(entries["extension/package.json"]));
  const identity = strFromU8(entries["extension.vsixmanifest"]).match(/<Identity\b[^>]*>/)![0];

  assert.equal(identity.match(/\bId="([^"]*)"/)?.[1], pkg.name, "Id must match package.json name");
  assert.equal(
    identity.match(/\bPublisher="([^"]*)"/)?.[1],
    pkg.publisher,
    "Publisher must match package.json publisher"
  );
});
