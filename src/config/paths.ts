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

/**
 * Normalizes user-supplied or CLI paths at the input boundary.
 * - Strips enclosing single and double quotation marks from terminal copy-paste
 * - Trims leading and trailing whitespace
 * - Strips Windows extended-length prefix (\\?\)
 * - Normalizes Windows backslashes and redundant slashes
 * - Resolves relative paths against custom base or cwd
 * - Strips trailing separators unless it is the filesystem root
 */
export function normalizeInputPath(rawPath: string, basePath?: string): string {
  if (typeof rawPath !== 'string') {
    throw new Error('Invalid path: path must be a string');
  }

  let cleaned = rawPath.trim();
  if (cleaned.length === 0) {
    throw new Error('Invalid path: path cannot be empty');
  }

  // Strip leading and trailing quotes (single or double, repeated/nested)
  while (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Handle mismatched/stray quotes from copy-paste
  if (cleaned.startsWith('"') || cleaned.startsWith("'")) {
    cleaned = cleaned.slice(1).trim();
  }
  if (cleaned.endsWith('"') || cleaned.endsWith("'")) {
    cleaned = cleaned.slice(0, -1).trim();
  }

  if (cleaned.length === 0) {
    throw new Error('Invalid path: path cannot be empty after stripping quotes');
  }

  // Strip Windows extended-length path prefix \\?\ or \\?\UNC\
  if (cleaned.startsWith('\\\\?\\UNC\\')) {
    cleaned = '\\\\' + cleaned.slice(8);
  } else if (cleaned.startsWith('\\\\?\\')) {
    cleaned = cleaned.slice(4);
  }

  // Resolve path
  const resolved = basePath ? path.resolve(basePath, cleaned) : path.resolve(cleaned);

  // Normalize path separators and strip trailing slash unless root
  let normalized = path.normalize(resolved);
  const parsed = path.parse(normalized);
  if (normalized !== parsed.root && (normalized.endsWith('\\') || normalized.endsWith('/'))) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

