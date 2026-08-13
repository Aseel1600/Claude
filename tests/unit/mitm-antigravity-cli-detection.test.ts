import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { detectAntigravity } from "../../src/mitm/detection/antigravity.ts";
import {
  ANTIGRAVITY_TARGET,
  ANTIGRAVITY_MITM_PROFILE,
} from "../../src/mitm/targets/antigravity.ts";

test("detectAntigravity — returns surface='ide' when only Antigravity.app is present", () => {
  const original = fs.existsSync;
  (fs as unknown as { existsSync: (p: fs.PathLike) => boolean }).existsSync = (p) => {
    return String(p).includes("Antigravity.app");
  };
  try {
    const res = detectAntigravity();
    assert.equal(res.installed, true);
    assert.equal(res.surface, "ide");
    assert.ok(typeof res.path === "string" && res.path.includes("Antigravity.app"));
  } finally {
    (fs as unknown as { existsSync: typeof fs.existsSync }).existsSync = original;
  }
});

test("detectAntigravity — returns surface='cli' when only agy binary is present", () => {
  const original = fs.existsSync;
  (fs as unknown as { existsSync: (p: fs.PathLike) => boolean }).existsSync = (p) => {
    const str = String(p);
    return str.endsWith("/agy") || str.endsWith("\\agy.exe");
  };
  try {
    const res = detectAntigravity();
    assert.equal(res.installed, true);
    assert.equal(res.surface, "cli");
    assert.ok(
      typeof res.path === "string" && (res.path.endsWith("agy") || res.path.endsWith("agy.exe"))
    );
  } finally {
    (fs as unknown as { existsSync: typeof fs.existsSync }).existsSync = original;
  }
});

test("detectAntigravity — returns surface='both' when both IDE and agy binary are present", () => {
  const original = fs.existsSync;
  (fs as unknown as { existsSync: (p: fs.PathLike) => boolean }).existsSync = (p) => {
    const str = String(p);
    return str.includes("Antigravity.app") || str.endsWith("/agy") || str.endsWith("\\agy.exe");
  };
  try {
    const res = detectAntigravity();
    assert.equal(res.installed, true);
    assert.equal(res.surface, "both");
  } finally {
    (fs as unknown as { existsSync: typeof fs.existsSync }).existsSync = original;
  }
});

test("detectAntigravity — returns installed=false when neither IDE nor agy is present", () => {
  const original = fs.existsSync;
  (fs as unknown as { existsSync: (p: fs.PathLike) => boolean }).existsSync = () => false;
  try {
    const res = detectAntigravity();
    assert.equal(res.installed, false);
    assert.equal(res.surface, undefined);
  } finally {
    (fs as unknown as { existsSync: typeof fs.existsSync }).existsSync = original;
  }
});

test("ANTIGRAVITY_TARGET — covers IDE & agy CLI surfaces accurately", () => {
  assert.equal(ANTIGRAVITY_TARGET.id, "antigravity");
  assert.match(ANTIGRAVITY_TARGET.name, /agy CLI/);
  assert.equal(
    ANTIGRAVITY_TARGET.setupTutorial.detection.command,
    "which antigravity || which agy"
  );
  assert.match(ANTIGRAVITY_MITM_PROFILE.description, /agy CLI/);
});
