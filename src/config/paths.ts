import path from 'node:path';
import os from 'node:os';
import {
  PROJ_DIR_NAME,
  CONFIG_FILE_NAME,
  IPC_FILE_NAME,
  TEMPLATES_DIR_NAME,
} from './constants.js';

/**
 * Resolves the root .proj directory path.
 * Checks custom argument or PROJ_CONFIG_DIR env var, falling back to ~/.proj.
 */
export function getConfigDir(customDir?: string): string {
  if (customDir) {
    return path.resolve(customDir);
  }
  if (process.env.PROJ_CONFIG_DIR) {
    return path.resolve(process.env.PROJ_CONFIG_DIR);
  }
  return path.join(os.homedir(), PROJ_DIR_NAME);
}

export function getTemplatesDir(customDir?: string): string {
  return path.join(getConfigDir(customDir), TEMPLATES_DIR_NAME);
}

export function getConfigFile(customDir?: string): string {
  return path.join(getConfigDir(customDir), CONFIG_FILE_NAME);
}

export function getIpcFile(customDir?: string): string {
  return path.join(getConfigDir(customDir), IPC_FILE_NAME);
}
