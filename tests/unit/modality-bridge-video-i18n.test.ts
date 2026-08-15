import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const messagesDirectory = path.resolve("src/i18n/messages");
const requiredKeys = [
  "modalityBridgeVideoTitle",
  "modalityBridgeVideoDesc",
  "modalityBridgeVideoRuntimeReady",
  "modalityBridgeVideoRuntimeUnavailable",
  "modalityBridgeVideoRuntimeInstall",
  "modalityBridgeVideoEnabled",
  "modalityBridgeVideoEnabledDesc",
  "modalityBridgeVideoModel",
  "modalityBridgeVideoModelInherited",
  "modalityBridgeVideoFrameCount",
  "modalityBridgeVideoMaxVideos",
] as const;

test("all 43 UI locale catalogs contain non-placeholder Video Bridge settings", () => {
  const catalogs = readdirSync(messagesDirectory)
    .filter((file) => file.endsWith(".json"))
    .sort();
  assert.equal(catalogs.length, 43);
  for (const file of catalogs) {
    const catalog = JSON.parse(readFileSync(path.join(messagesDirectory, file), "utf8")) as {
      settings?: Record<string, unknown>;
    };
    for (const key of requiredKeys) {
      const value = catalog.settings?.[key];
      assert.equal(typeof value, "string", `${file}: settings.${key} missing`);
      assert.ok(String(value).trim().length > 0, `${file}: settings.${key} empty`);
      assert.equal(String(value).startsWith("__MISSING__:"), false, `${file}: ${key} placeholder`);
    }
  }
});
