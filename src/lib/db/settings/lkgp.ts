/**
 * db/settings/lkgp.ts — Last Known Good Provider (LKGP) persistence.
 */

import { getDbInstance } from "../core";

export interface LKGPRecord {
  provider: string;
  connectionId?: string;
}

export async function getLKGP(comboName: string, modelId: string): Promise<LKGPRecord | null> {
  const db = getDbInstance();
  const key = `${comboName}:${modelId}`;
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'lkgp' AND key = ?")
    .get(key) as { value?: string } | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    if (typeof parsed === "object" && parsed !== null && "provider" in parsed) {
      return parsed as LKGPRecord;
    }
    return { provider: String(parsed) };
  } catch {
    return { provider: row.value };
  }
}

export async function setLKGP(
  comboName: string,
  modelId: string,
  providerId: string,
  connectionId?: string
) {
  const db = getDbInstance();
  const key = `${comboName}:${modelId}`;
  const value: LKGPRecord = { provider: providerId };
  if (connectionId) value.connectionId = connectionId;
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('lkgp', ?, ?)").run(
    key,
    JSON.stringify(value)
  );
}

export function clearAllLKGP(): void {
  const db = getDbInstance();
  db.prepare("DELETE FROM key_value WHERE namespace = 'lkgp'").run();
}

/**
 * Delete persisted LKGP pins whose connectionId references a removed provider
 * connection. Provider-level pins and legacy/unparseable values are preserved.
 */
export async function deleteLKGPByConnectionIds(connectionIds: string[]): Promise<number> {
  if (connectionIds.length === 0) return 0;

  const deletedConnectionIds = new Set(connectionIds.filter(Boolean));
  if (deletedConnectionIds.size === 0) return 0;

  const db = getDbInstance();
  const rows = db
    .prepare("SELECT key, value FROM key_value WHERE namespace = 'lkgp'")
    .all() as Array<{ key?: string; value?: string }>;

  const staleKeys: string[] = [];

  for (const row of rows) {
    if (!row?.key || !row.value) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;

    const connectionId = (parsed as LKGPRecord).connectionId;
    if (typeof connectionId === "string" && deletedConnectionIds.has(connectionId)) {
      staleKeys.push(row.key);
    }
  }

  if (staleKeys.length === 0) return 0;

  const deleteStatement = db.prepare("DELETE FROM key_value WHERE namespace = 'lkgp' AND key = ?");
  for (const key of staleKeys) {
    deleteStatement.run(key);
  }

  const { invalidateCachedLKGP } = await import("../readCache");
  for (const key of staleKeys) {
    invalidateCachedLKGP(key);
  }

  return staleKeys.length;
}
