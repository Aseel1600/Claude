import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveDataDir } from "@/lib/dataPaths";
import { tryOpenSync } from "@/lib/db/adapters/driverFactory";

export const FULL_BACKUP_FILES = [
  { name: "storage.sqlite" },
  { name: "settings.json" },
  { name: "combos.json" },
  { name: "providers.json" },
] as const;

export type FullBackupOptions = {
  name?: string;
  cloud?: boolean;
  encrypt?: boolean;
  keyFile?: string;
  exclude?: string[];
  retention?: number | null;
  passphrase?: string | null;
};

export type FullBackupMessages = {
  creating?: string;
  noPassphrase?: string;
  noFiles?: string;
  done?: (backupPath: string) => string;
  failed?: (error: string) => string;
  cloudUploaded?: (url: string) => string;
  cloudFailed?: string;
  serverOffline?: string;
};

export type FullBackupLogger = {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export type FullBackupUpload = (input: {
  backupPath: string;
  info: FullBackupInfo;
}) => Promise<0 | 1>;

export type FullBackupInfo = {
  timestamp: string;
  version: "omniroute-cli-v1";
  encrypted: boolean;
  files: string[];
};

type CreateFullBackupDeps = {
  dataDir?: string;
  logger?: FullBackupLogger;
  messages?: FullBackupMessages;
  uploadBackupToCloud?: FullBackupUpload;
};

function getBackupDir(dataDir = resolveDataDir()) {
  return join(dataDir, "backups");
}

function matchesGlob(fileName: string, pattern: string) {
  if (!pattern.includes("*")) return fileName === pattern;
  const parts = pattern.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i === 0) {
      if (!fileName.startsWith(part)) return false;
      pos = part.length;
    } else if (i === parts.length - 1) {
      if (!fileName.endsWith(part)) return false;
      if (fileName.length < pos + part.length) return false;
    } else {
      const idx = fileName.indexOf(part, pos);
      if (idx === -1) return false;
      pos = idx + part.length;
    }
  }
  return true;
}

function shouldExclude(fileName: string, patterns: string[] | undefined) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => matchesGlob(fileName, p));
}

async function encryptFile(srcPath: string, destPath: string, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const tmpCipherPath = `${destPath}.ciphertext`;
  await pipeline(createReadStream(srcPath), cipher, createWriteStream(tmpCipherPath));
  const authTag = cipher.getAuthTag();
  const out = createWriteStream(destPath);
  try {
    await new Promise<void>((resolve, reject) => {
      out.write(Buffer.concat([salt, iv, authTag]), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await pipeline(createReadStream(tmpCipherPath), out);
  } finally {
    try {
      unlinkSync(tmpCipherPath);
    } catch {}
  }
}

async function backupSqliteFile(sourcePath: string, destPath: string) {
  const db = tryOpenSync(sourcePath, { readonly: true, fileMustExist: true });
  if (!db) {
    copyFileSync(sourcePath, destPath);
    return;
  }
  try {
    await db.backup(destPath);
  } finally {
    db.close();
  }
}

async function pruneBackups(backupDir: string, retention: number | null | undefined) {
  if (!retention || retention <= 0 || !existsSync(backupDir)) return;
  try {
    const dirs = readdirSync(backupDir)
      .filter((f) => f.startsWith("omniroute-backup-"))
      .sort()
      .reverse();
    for (const old of dirs.slice(retention)) {
      const { rmSync } = await import("node:fs");
      rmSync(join(backupDir, old), { recursive: true, force: true });
    }
  } catch {}
}

async function getMachineCliToken() {
  try {
    const crypto = await import("node:crypto");
    const { machineIdSync } = await import("node-machine-id");
    const mid = machineIdSync();
    return crypto
      .createHash("sha256")
      .update(`${mid}omniroute-cli-auth-v1`)
      .digest("hex")
      .substring(0, 32);
  } catch {
    return "";
  }
}

function getLocalBaseUrl() {
  const envUrl = process.env.OMNIROUTE_BASE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const port = process.env.PORT || "20128";
  return `http://localhost:${port}`;
}

async function* createBackupMultipartStream(
  backupPath: string,
  info: FullBackupInfo,
  boundary: string
) {
  const encoder = new TextEncoder();
  const encode = (value: string) => encoder.encode(value);
  yield encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="info"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(info)}\r\n`
  );
  for (const fname of readdirSync(backupPath)) {
    const fullPath = join(backupPath, fname);
    const stat = statSync(fullPath);
    if (!stat.isFile()) continue;
    const safeName = fname.replace(/["\r\n]/g, "_");
    yield encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    yield* createReadStream(fullPath);
    yield encode("\r\n");
  }
  yield encode(`--${boundary}--\r\n`);
}

export async function uploadFullBackupToLocalServer({
  backupPath,
  info,
}: {
  backupPath: string;
  info: FullBackupInfo;
}): Promise<0 | 1> {
  try {
    const boundary = `omniroute-backup-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
    const headers = new Headers({
      accept: "application/json",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });
    const apiKey = process.env.OMNIROUTE_API_KEY;
    if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
    const cliToken = process.env.OMNIROUTE_CLI_TOKEN ?? (await getMachineCliToken());
    if (cliToken) headers.set("x-omniroute-cli-token", cliToken);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${getLocalBaseUrl()}/api/db-backups/cloud`, {
      method: "POST",
      headers,
      body: Readable.from(createBackupMultipartStream(backupPath, info, boundary)),
      duplex: "half",
      signal: controller.signal,
    } as RequestInit).finally(() => clearTimeout(timeout));
    return res.ok ? 0 : 1;
  } catch {
    return 1;
  }
}

export async function createFullBackup(
  opts: FullBackupOptions = {},
  deps: CreateFullBackupDeps = {}
) {
  const logger = deps.logger || console;
  const messages = deps.messages || {};
  const dataDir = deps.dataDir || resolveDataDir();
  const backupDir = getBackupDir(dataDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = opts.name ? String(opts.name).replace(/[/\\]/g, "_") : null;
  const backupName = safeName ? `omniroute-backup-${safeName}` : `omniroute-backup-${timestamp}`;
  const backupPath = join(backupDir, backupName);
  const excludePatterns = opts.exclude || [];

  if (messages.creating) logger.log?.(messages.creating);

  let passphrase = opts.passphrase || null;
  if (opts.encrypt) {
    if (opts.keyFile) {
      passphrase = readFileSync(opts.keyFile, "utf8").trim();
    }
    if (!passphrase) {
      if (messages.noPassphrase) logger.error?.(messages.noPassphrase);
      return 1;
    }
  }

  try {
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

    let backedUp = 0;
    let skipped = 0;

    for (const file of FULL_BACKUP_FILES) {
      if (shouldExclude(file.name, excludePatterns)) {
        skipped++;
        continue;
      }
      const sourcePath = join(dataDir, file.name);
      if (existsSync(sourcePath)) {
        const destName = opts.encrypt ? `${file.name}.enc` : file.name;
        const destPath = join(backupPath, destName);
        mkdirSync(dirname(destPath), { recursive: true });
        if (file.name.endsWith(".sqlite")) {
          const tmpPath = destPath.replace(/\.enc$/, "");
          await backupSqliteFile(sourcePath, tmpPath);
          if (opts.encrypt && passphrase) {
            await encryptFile(tmpPath, destPath, passphrase);
            unlinkSync(tmpPath);
          }
        } else if (opts.encrypt && passphrase) {
          await encryptFile(sourcePath, destPath, passphrase);
        } else {
          copyFileSync(sourcePath, destPath);
        }
        backedUp++;
      } else {
        skipped++;
      }
    }

    if (backedUp > 0) {
      const info: FullBackupInfo = {
        timestamp: new Date().toISOString(),
        version: "omniroute-cli-v1",
        encrypted: !!opts.encrypt,
        files: FULL_BACKUP_FILES.filter(
          (f) => existsSync(join(dataDir, f.name)) && !shouldExclude(f.name, excludePatterns)
        ).map((f) => (opts.encrypt ? `${f.name}.enc` : f.name)),
      };
      writeFileSync(join(backupPath, "backup-info.json"), JSON.stringify(info, null, 2), "utf8");

      if (opts.cloud) {
        const upload = deps.uploadBackupToCloud || uploadFullBackupToLocalServer;
        const cloudCode = await upload({ backupPath, info });
        if (cloudCode !== 0) {
          if (messages.cloudFailed) logger.warn?.(messages.cloudFailed);
        } else if (messages.cloudUploaded) {
          logger.log?.(messages.cloudUploaded("(stored)"));
        }
      }

      if (opts.retention) {
        await pruneBackups(backupDir, opts.retention);
      }

      if (messages.done) logger.log?.(messages.done(backupPath));
      logger.log?.(
        `\x1b[2m  ${backedUp} backed up, ${skipped} skipped${opts.encrypt ? " (encrypted)" : ""}\x1b[0m`
      );
      return 0;
    }

    if (messages.noFiles) logger.log?.(messages.noFiles);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (messages.failed) logger.error?.(messages.failed(message));
    else logger.error?.(message);
    return 1;
  }
}

export function getFullBackupPath(backupId: string, dataDir = resolveDataDir()) {
  const safeBackupId = String(backupId).replace(/[/\\]/g, "_");
  return join(getBackupDir(dataDir), `omniroute-backup-${safeBackupId}`);
}

export function getFullBackupDir(dataDir = resolveDataDir()) {
  return getBackupDir(dataDir);
}

export function getFullBackupFileNames() {
  return FULL_BACKUP_FILES.map((file) => file.name);
}

export function getFullBackupDisplayId(dirName: string) {
  return basename(dirName).replace("omniroute-backup-", "");
}
