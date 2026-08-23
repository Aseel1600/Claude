import { logger } from './logger';
import { getServiceStatus } from './status';
import { getCliproxyBinaryPath, spawnCliproxy } from './cliproxy/cliproxy';
import fs from 'fs';
import path from 'path';

const IS_WINDOWS = process.platform === 'win32';

export async function installVersion(version) {
  logger.info(`Installing version ${version}`);
  // Placeholder for actual installation logic
  // In a real scenario, this would download and extract the correct binary
  // For this fix, we assume the binary is already in BIN_DIR and just need to ensure it's named correctly.

  const expectedBinaryName = IS_WINDOWS ? 'cliproxyapi.exe' : 'cliproxyapi';
  const expectedBinaryPath = path.join(BIN_DIR, expectedBinaryName);

  // If the binary exists but is not named correctly, rename it.
  // This handles cases where a previous install might have left an extensionless file.
  if (IS_WINDOWS) {
    const potentialOldPath = path.join(BIN_DIR, 'cliproxyapi');
    if (fs.existsSync(potentialOldPath) && !fs.existsSync(expectedBinaryPath)) {
      logger.info(`Renaming ${potentialOldPath} to ${expectedBinaryPath}`);
      fs.renameSync(potentialOldPath, expectedBinaryPath);
    }
  }

  // Ensure the cliproxy binary exists at the expected path
  if (!fs.existsSync(expectedBinaryPath)) {
    throw new Error(`Cliproxy binary not found at ${expectedBinaryPath}. Please ensure it's installed correctly.`);
  }

  logger.info(`Version ${version} installed successfully.`);
}

export async function getServiceStatus(serviceName) {
  const status = await getServiceStatus(serviceName);

  if (serviceName === 'bifrost' && status && status.pid === null) {
    // Attempt to find the PID if it's null but the service is expected to be running
    try {
      const bifrostPath = path.join(BIN_DIR, 'bifrost');
      if (fs.existsSync(bifrostPath)) {
        const result = spawnCliproxy(['--pid']); // Assuming bifrost has a --pid flag to get its own PID
        if (result.stdout) {
          const pid = parseInt(result.stdout.toString().trim(), 10);
          if (!isNaN(pid)) {
            status.pid = pid;
          }
        }
      }
    } catch (e) {
      logger.warn(`Could not retrieve PID for bifrost: ${e.message}`);
    }
  }

  return status;
}
