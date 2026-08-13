/**
 * Antigravity IDE and agy CLI installation detection.
 * Purely filesystem-based — no shell interpolation (Hard Rule #13).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DetectionResult } from "../types.ts";

const HOME = os.homedir();

const IDE_PATHS = [
  // macOS
  "/Applications/Antigravity.app",
  path.join(HOME, "Applications", "Antigravity.app"),
  // Linux (AppImage / system install)
  "/usr/bin/antigravity",
  "/usr/local/bin/antigravity",
  path.join(HOME, ".local", "bin", "antigravity"),
  // Windows
  path.join(
    process.env.LOCALAPPDATA ?? path.join(HOME, "AppData", "Local"),
    "Programs",
    "Antigravity",
    "Antigravity.exe"
  ),
];

const CLI_PATHS = [
  // macOS / Linux system & user bin
  "/usr/bin/agy",
  "/usr/local/bin/agy",
  path.join(HOME, ".local", "bin", "agy"),
  path.join(HOME, ".npm-global", "bin", "agy"),
  path.join(HOME, ".cargo", "bin", "agy"),
  path.join(HOME, ".yarn", "bin", "agy"),
  // Windows
  path.join(
    process.env.LOCALAPPDATA ?? path.join(HOME, "AppData", "Local"),
    "Programs",
    "Antigravity",
    "agy.exe"
  ),
  path.join(process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming"), "npm", "agy.cmd"),
  path.join(HOME, ".cargo", "bin", "agy.exe"),
];

export function detectAntigravity(): DetectionResult {
  let ideHit: string | undefined;
  for (const p of IDE_PATHS) {
    if (fs.existsSync(p)) {
      ideHit = p;
      break;
    }
  }

  let cliHit: string | undefined;
  for (const p of CLI_PATHS) {
    if (fs.existsSync(p)) {
      cliHit = p;
      break;
    }
  }

  if (ideHit && cliHit) {
    return { installed: true, path: ideHit, surface: "both" };
  }
  if (ideHit) {
    return { installed: true, path: ideHit, surface: "ide" };
  }
  if (cliHit) {
    return { installed: true, path: cliHit, surface: "cli" };
  }

  return { installed: false };
}
