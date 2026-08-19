import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveOpenCodeDirs } from "../../bin/cli/commands/setup-open-code.mjs";

test("resolveOpenCodeDirs uses XDG paths on all platforms (not %APPDATA%)", () => {
  const prevConfig = process.env.XDG_CONFIG_HOME;
  const prevData = process.env.XDG_DATA_HOME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
  try {
    const { configDir, dataDir } = resolveOpenCodeDirs();
    // OpenCode (Bun-based) resolves XDG-style paths everywhere, including Windows.
    assert.ok(
      configDir.endsWith(join(".config", "opencode")),
      `expected configDir to end with .config/opencode, got: ${configDir}`
    );
    assert.ok(
      dataDir.endsWith(join(".local", "share", "opencode")),
      `expected dataDir to end with .local/share/opencode, got: ${dataDir}`
    );
    // Regression guard: the old Windows branch pointed at %APPDATA% / %LOCALAPPDATA%.
    assert.ok(
      !configDir.includes("AppData"),
      `configDir must not resolve into %APPDATA%: ${configDir}`
    );
    assert.ok(
      !dataDir.includes("AppData"),
      `dataDir must not resolve into %LOCALAPPDATA%: ${dataDir}`
    );
  } finally {
    if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevConfig;
    if (prevData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevData;
  }
});

test("resolveOpenCodeDirs honours XDG_CONFIG_HOME / XDG_DATA_HOME", () => {
  const prevConfig = process.env.XDG_CONFIG_HOME;
  const prevData = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = "/custom/xdg-config";
  process.env.XDG_DATA_HOME = "/custom/xdg-data";
  try {
    const { configDir, dataDir } = resolveOpenCodeDirs();
    assert.equal(configDir, join("/custom/xdg-config", "opencode"));
    assert.equal(dataDir, join("/custom/xdg-data", "opencode"));
  } finally {
    if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevConfig;
    if (prevData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevData;
  }
});
