import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  getConfig,
  updateConfig,
  DEFAULT_TTL_DAYS,
} from '../config/index.js';
import {
  validateProjectName,
  validateTemplate,
  generateTemplateFiles,
} from './scaffold.js';
import type {
  ProjectTemplate,
  ThrowawayRecord,
  ThrowawayOptions,
  GraduateOptions,
  GraduateResult,
  DeleteThrowawayResult,
} from './types.js';

export * from './types.js';

/**
 * Creates a time-boxed throwaway scratchpad project and registers TTL metadata in configuration.
 */
export async function createThrowaway(
  name: string,
  ttlDays?: number,
  template?: string,
  options?: ThrowawayOptions
): Promise<ThrowawayRecord> {
  validateProjectName(name);

  const trimmedName = name.trim();
  const config = getConfig({ configDir: options?.configDir });

  // Validate TTL
  let resolvedTtl = config.defaultTtlDays || DEFAULT_TTL_DAYS;
  if (ttlDays !== undefined) {
    if (typeof ttlDays !== 'number' || !Number.isFinite(ttlDays) || ttlDays <= 0) {
      throw new Error(`Invalid TTL: ttlDays must be a positive number, received ${ttlDays}`);
    }
    resolvedTtl = ttlDays;
  }

  // Validate Template
  const resolvedTemplate: ProjectTemplate = (template || 'minimal') as ProjectTemplate;
  validateTemplate(resolvedTemplate);

  // Resolve throwaways directory root
  const throwawaysRoot = options?.throwawaysRoot
    ? path.resolve(options.throwawaysRoot)
    : path.resolve(config.throwawaysRoot);

  const projectPath = path.join(throwawaysRoot, trimmedName);

  if (fs.existsSync(projectPath)) {
    throw new Error(`Throwaway project "${trimmedName}" already exists at ${projectPath}`);
  }

  // Ensure throwaways parent directory exists
  if (!fs.existsSync(throwawaysRoot)) {
    fs.mkdirSync(throwawaysRoot, { recursive: true });
  }

  // Create throwaway project directory
  fs.mkdirSync(projectPath, { recursive: true });

  try {
    // Generate starter files based on chosen template
    generateTemplateFiles(projectPath, trimmedName, resolvedTemplate, {
      configDir: options?.configDir,
    });

    // Calculate timestamps
    const now = options?.now ? new Date(options.now) : new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + resolvedTtl * 24 * 60 * 60 * 1000).toISOString();

    const record: ThrowawayRecord = {
      name: trimmedName,
      path: projectPath,
      createdAt,
      expiresAt,
      ttlDays: resolvedTtl,
      template: resolvedTemplate,
    };

    // Register in config.json
    const existingThrowaways = config.throwaways || {};
    updateConfig(
      {
        throwaways: {
          ...existingThrowaways,
          [trimmedName]: record,
        },
      },
      { configDir: options?.configDir }
    );

    return record;
  } catch (err) {
    if (fs.existsSync(projectPath)) {
      try {
        fs.rmSync(projectPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
    throw err;
  }
}

/**
 * Helper to look up a throwaway entry from config dictionary by key OR record.name.
 * Returns the dictionary key and record, or null if not found.
 */
export function findThrowawayEntry(
  throwaways: Record<string, ThrowawayRecord> | undefined,
  name: string
): { key: string; record: ThrowawayRecord } | null {
  if (!throwaways || typeof throwaways !== 'object') {
    return null;
  }

  const trimmed = name.trim();

  // 1. Direct key lookup
  if (throwaways[trimmed] && typeof throwaways[trimmed] === 'object') {
    const rec = throwaways[trimmed];
    return {
      key: trimmed,
      record: {
        ...rec,
        name: rec.name || trimmed,
      },
    };
  }

  // 2. Lookup by record.name or case-insensitive match
  for (const [key, rec] of Object.entries(throwaways)) {
    if (rec && typeof rec === 'object') {
      if (rec.name === trimmed || key === trimmed) {
        return {
          key,
          record: {
            ...rec,
            name: rec.name || key,
          },
        };
      }
      if (
        (typeof rec.name === 'string' && rec.name.toLowerCase() === trimmed.toLowerCase()) ||
        key.toLowerCase() === trimmed.toLowerCase()
      ) {
        return {
          key,
          record: {
            ...rec,
            name: rec.name || key,
          },
        };
      }
    }
  }

  return null;
}

/**
 * Checks whether a throwaway scratchpad record has expired given a reference time.
 */
export function isThrowawayExpired(
  record: ThrowawayRecord,
  now?: Date | string | number
): boolean {
  if (!record?.expiresAt) {
    return false;
  }
  const refTime = now !== undefined ? new Date(now).getTime() : Date.now();
  const expireTime = new Date(record.expiresAt).getTime();
  return refTime > expireTime;
}

/**
 * Checks and returns all throwaways whose expiration timestamp has passed.
 */
export function checkExpiredThrowaways(
  options?: ThrowawayOptions & { now?: Date | string | number }
): ThrowawayRecord[] {
  const config = getConfig({ configDir: options?.configDir });
  const throwaways = config.throwaways || {};

  const expired: ThrowawayRecord[] = [];

  for (const [key, rawRecord] of Object.entries(throwaways)) {
    if (!rawRecord || typeof rawRecord !== 'object') {
      continue;
    }
    const record: ThrowawayRecord = {
      ...rawRecord,
      name: rawRecord.name || key,
    };
    if (isThrowawayExpired(record, options?.now)) {
      expired.push(record);
    }
  }

  return expired.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extends the TTL expiration timestamp of an active throwaway scratchpad.
 */
export function extendThrowaway(
  name: string,
  days: number,
  options?: ThrowawayOptions
): ThrowawayRecord {
  validateProjectName(name);

  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid extension days: days must be a positive number, received ${days}`);
  }

  const trimmedName = name.trim();
  const config = getConfig({ configDir: options?.configDir });
  const throwaways = config.throwaways || {};
  const found = findThrowawayEntry(throwaways, trimmedName);

  if (!found) {
    throw new Error(`Throwaway "${trimmedName}" not found in configuration`);
  }

  const { key: foundKey, record } = found;
  const nowTime = options?.now !== undefined ? new Date(options.now).getTime() : Date.now();
  const currentExpiresTime = new Date(record.expiresAt).getTime();
  const baseTime = Math.max(nowTime, currentExpiresTime);
  const newExpiresAt = new Date(
    baseTime + days * 24 * 60 * 60 * 1000
  ).toISOString();

  const effectiveName = record.name || trimmedName;
  const updatedRecord: ThrowawayRecord = {
    ...record,
    name: effectiveName,
    ttlDays: (record.ttlDays || 0) + days,
    expiresAt: newExpiresAt,
  };

  const updatedThrowaways = { ...throwaways };
  if (foundKey !== effectiveName) {
    delete updatedThrowaways[foundKey];
  }
  updatedThrowaways[effectiveName] = updatedRecord;

  updateConfig(
    {
      throwaways: updatedThrowaways,
    },
    { configDir: options?.configDir }
  );

  return updatedRecord;
}

/**
 * Deletes a throwaway scratchpad from disk and purges metadata from config.
 */
export function deleteThrowaway(
  name: string,
  options?: ThrowawayOptions
): DeleteThrowawayResult {
  validateProjectName(name);

  const trimmedName = name.trim();
  const config = getConfig({ configDir: options?.configDir });
  const throwawaysRoot = options?.throwawaysRoot
    ? path.resolve(options.throwawaysRoot)
    : path.resolve(config.throwawaysRoot);

  const found = findThrowawayEntry(config.throwaways, trimmedName);
  const projectPath = found?.record?.path
    ? path.resolve(found.record.path)
    : path.join(throwawaysRoot, trimmedName);

  const dirExists = fs.existsSync(projectPath);

  if (!dirExists && !found) {
    throw new Error(`Throwaway "${trimmedName}" does not exist`);
  }

  if (dirExists) {
    try {
      fs.rmSync(projectPath, { recursive: true, force: true });
    } catch {
      // Gracefully handle file removal error
    }
  }

  if (config.throwaways) {
    const updatedThrowaways = { ...config.throwaways };
    let changed = false;
    if (found?.key && updatedThrowaways[found.key] !== undefined) {
      delete updatedThrowaways[found.key];
      changed = true;
    }
    if (updatedThrowaways[trimmedName] !== undefined) {
      delete updatedThrowaways[trimmedName];
      changed = true;
    }
    if (found?.record?.name && updatedThrowaways[found.record.name] !== undefined) {
      delete updatedThrowaways[found.record.name];
      changed = true;
    }
    if (changed) {
      updateConfig(
        {
          throwaways: updatedThrowaways,
        },
        { configDir: options?.configDir }
      );
    }
  }

  return {
    name: found?.record?.name || trimmedName,
    path: projectPath,
    deleted: true,
  };
}

/**
 * Graduates a throwaway scratchpad into a permanent Git-tracked project repository.
 */
export async function graduateThrowaway(
  name: string,
  options?: GraduateOptions
): Promise<GraduateResult> {
  validateProjectName(name);

  const trimmedName = name.trim();
  const config = getConfig({ configDir: options?.configDir });

  const throwawaysRoot = options?.throwawaysRoot
    ? path.resolve(options.throwawaysRoot)
    : path.resolve(config.throwawaysRoot);

  const projectsRoot = options?.projectsRoot
    ? path.resolve(options.projectsRoot)
    : path.resolve(config.projectsRoot);

  const found = findThrowawayEntry(config.throwaways, trimmedName);
  const effectiveName = found?.record?.name || trimmedName;
  const srcPath = found?.record?.path
    ? path.resolve(found.record.path)
    : path.join(throwawaysRoot, effectiveName);
  const destPath = path.join(projectsRoot, effectiveName);

  if (!fs.existsSync(srcPath)) {
    throw new Error(
      `Cannot graduate throwaway "${effectiveName}": scratchpad does not exist at ${srcPath}`
    );
  }

  if (fs.existsSync(destPath)) {
    throw new Error(
      `Cannot graduate throwaway "${effectiveName}": destination path already exists at ${destPath}`
    );
  }

  if (!fs.existsSync(projectsRoot)) {
    fs.mkdirSync(projectsRoot, { recursive: true });
  }

  // Migrate directory to canonical projects root
  try {
    fs.renameSync(srcPath, destPath);
  } catch {
    // Cross-device link fallback
    fs.cpSync(srcPath, destPath, { recursive: true });
    fs.rmSync(srcPath, { recursive: true, force: true });
  }

  // Initialize Git repository if not already present
  const git = simpleGit(destPath, { maxConcurrentProcesses: 2 });
  const gitDir = path.join(destPath, '.git');
  let isRepo = false;

  if (fs.existsSync(gitDir)) {
    try {
      isRepo = await git.checkIsRepo();
    } catch {
      isRepo = false;
    }
  }

  let commitHash: string | undefined;
  if (!isRepo) {
    await git.init();
    await git.addConfig('user.name', options?.gitAuthorName || 'proj-agent', false, 'local');
    await git.addConfig('user.email', options?.gitAuthorEmail || 'agent@proj.local', false, 'local');
    await git.add('.');
    await git.commit('checkpoint: Graduated from throwaway scratchpad');
    commitHash = (await git.revparse(['HEAD'])).trim();
  }

  // Purge scratchpad metadata from config.json
  if (config.throwaways) {
    const updatedThrowaways = { ...config.throwaways };
    let changed = false;
    if (found?.key && updatedThrowaways[found.key] !== undefined) {
      delete updatedThrowaways[found.key];
      changed = true;
    }
    if (updatedThrowaways[effectiveName] !== undefined) {
      delete updatedThrowaways[effectiveName];
      changed = true;
    }
    if (updatedThrowaways[trimmedName] !== undefined) {
      delete updatedThrowaways[trimmedName];
      changed = true;
    }
    if (changed) {
      updateConfig(
        {
          throwaways: updatedThrowaways,
        },
        { configDir: options?.configDir }
      );
    }
  }

  return {
    name: effectiveName,
    path: destPath,
    previousPath: srcPath,
    isGit: true,
    commitHash,
  };
}
