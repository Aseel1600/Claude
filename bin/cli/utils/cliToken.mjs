import crypto from "node:crypto";

const BUILTIN_DEFAULT_SALT = "omniroute-cli-auth-v1";
export const CLI_TOKEN_HEADER = "x-omniroute-cli-token";

let _cached = null;
let _cachedSalt = null;

export function deriveCliToken(machineIdModule, salt) {
  try {
    const machineIdSync = machineIdModule?.machineIdSync || machineIdModule?.default?.machineIdSync;
    if (typeof machineIdSync !== "function") return "";
    const rawId = machineIdSync(true);
    if (!rawId) return "";
    return crypto.createHmac("sha256", rawId).update(salt).digest("hex");
  } catch {
    return "";
  }
}

export async function getCliToken() {
  const salt = process.env.OMNIROUTE_CLI_SALT || BUILTIN_DEFAULT_SALT;
  if (_cached !== null && _cachedSalt === salt) return _cached;
  try {
    const imported = await import("node-machine-id");
    _cached = deriveCliToken(imported, salt);
    _cachedSalt = salt;
  } catch {
    _cached = "";
    _cachedSalt = salt;
  }
  return _cached;
}
