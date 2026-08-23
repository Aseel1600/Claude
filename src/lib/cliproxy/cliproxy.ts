import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { logger } from '../logger';
import { getAssetInfo } from './asset_info';
import { BIN_DIR } from '../constants';

const IS_WINDOWS = process.platform === 'win32';

export async function installCliproxy(version) {
  const assetInfo = await getAssetInfo(version);
  if (!assetInfo) {
    throw new Error(`Could not find asset info for version ${version}`);
  }

  const asset = assetInfo.assets.find(a => {
    if (IS_WINDOWS) {
      return a.name.includes('windows_amd64');
    } else {
      return a.name.includes('linux') && a.name.includes('amd64');
    }
  });

  if (!asset) {
    throw new Error(`Could not find suitable asset for ${process.platform} on version ${version}`);
  }

  const assetUrl = asset.browser_download_url;
  const assetFileName = asset.name;
  const downloadPath = path.join(os.tmpdir(), assetFileName);

  logger.info(`Downloading cliproxy from ${assetUrl} to ${downloadPath}`);
  const response = await fetch(assetUrl);
  const fileStream = fs.createWriteStream(downloadPath);

  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  logger.info(`Downloaded cliproxy to ${downloadPath}`);

  const extractDir = path.join(BIN_DIR);
  await fs.promises.mkdir(extractDir, { recursive: true });

  if (assetFileName.endsWith('.zip')) {
    const AdmZip = await import('adm-zip');
    const zip = new AdmZip.default(downloadPath);
    zip.extractAllTo(extractDir, true);
    logger.info(`Extracted zip to ${extractDir}`);
  } else {
    // Assuming it's a single binary file for other platforms
    const binaryName = IS_WINDOWS ? 'cliproxyapi.exe' : 'cliproxyapi';
    const extractedBinaryPath = path.join(extractDir, binaryName);
    await fs.promises.rename(downloadPath, extractedBinaryPath);
    logger.info(`Moved binary to ${extractedBinaryPath}`);
  }

  // Ensure the binary has execute permissions (especially for Linux/macOS)
  if (!IS_WINDOWS) {
    fs.chmodSync(path.join(extractDir, 'cliproxyapi'), '755');
  }

  // Clean up the downloaded zip file
  fs.unlinkSync(downloadPath);
}

export function getCliproxyBinaryPath() {
  return IS_WINDOWS ? path.join(BIN_DIR, 'cliproxyapi.exe') : path.join(BIN_DIR, 'cliproxyapi');
}

export function spawnCliproxy(args = []) {
  const binaryPath = getCliproxyBinaryPath();
  logger.info(`Spawning cliproxy at ${binaryPath} with args: ${args.join(' ')}`);
  const result = spawnSync(binaryPath, args, {
    stdio: 'inherit',
    shell: IS_WINDOWS // Use shell for Windows to handle PATHEXT correctly
  });

  if (result.error) {
    throw result.error;
  }
  return result;
}
