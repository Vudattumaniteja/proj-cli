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

  for (const record of Object.values(throwaways)) {
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
  const record = throwaways[trimmedName];

  if (!record) {
    throw new Error(`Throwaway "${trimmedName}" not found in configuration`);
  }

  const nowTime = options?.now !== undefined ? new Date(options.now).getTime() : Date.now();
  const currentExpiresTime = new Date(record.expiresAt).getTime();
  const baseTime = Math.max(nowTime, currentExpiresTime);
  const newExpiresAt = new Date(
    baseTime + days * 24 * 60 * 60 * 1000
  ).toISOString();

  const updatedRecord: ThrowawayRecord = {
    ...record,
    ttlDays: record.ttlDays + days,
    expiresAt: newExpiresAt,
  };

  updateConfig(
    {
      throwaways: {
        ...throwaways,
        [trimmedName]: updatedRecord,
      },
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

  const projectPath = path.join(throwawaysRoot, trimmedName);
  const record = config.throwaways?.[trimmedName];
  const dirExists = fs.existsSync(projectPath);

  if (!dirExists && !record) {
    throw new Error(`Throwaway "${trimmedName}" does not exist`);
  }

  if (dirExists) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }

  if (record) {
    const updatedThrowaways = { ...config.throwaways };
    delete updatedThrowaways[trimmedName];
    updateConfig(
      {
        throwaways: updatedThrowaways,
      },
      { configDir: options?.configDir }
    );
  }

  return {
    name: trimmedName,
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

  const srcPath = path.join(throwawaysRoot, trimmedName);
  const destPath = path.join(projectsRoot, trimmedName);

  if (!fs.existsSync(srcPath)) {
    throw new Error(
      `Cannot graduate throwaway "${trimmedName}": scratchpad does not exist at ${srcPath}`
    );
  }

  if (fs.existsSync(destPath)) {
    throw new Error(
      `Cannot graduate throwaway "${trimmedName}": destination path already exists at ${destPath}`
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
  if (config.throwaways && config.throwaways[trimmedName]) {
    const updatedThrowaways = { ...config.throwaways };
    delete updatedThrowaways[trimmedName];
    updateConfig(
      {
        throwaways: updatedThrowaways,
      },
      { configDir: options?.configDir }
    );
  }

  return {
    name: trimmedName,
    path: destPath,
    previousPath: srcPath,
    isGit: true,
    commitHash,
  };
}
