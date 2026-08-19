import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_AGENTS_TEMPLATE,
  DEFAULT_GITIGNORE_TEMPLATE,
  DEFAULT_AGENTS_TEMPLATE_NAME,
  DEFAULT_GITIGNORE_TEMPLATE_NAME,
  DEFAULT_TTL_DAYS,
} from './constants.js';
import {
  getConfigDir,
  getTemplatesDir,
  getConfigFile,
  getIpcFile,
} from './paths.js';
import type { ProjConfig, ConfigOptions } from './types.js';

export * from './constants.js';
export * from './paths.js';
export * from './types.js';

/**
 * Returns default configuration object.
 */
export function getDefaultConfig(homeDir: string = os.homedir()): ProjConfig {
  const projectsRoot = path.join(homeDir, 'projects');
  const throwawaysRoot = path.join(projectsRoot, 'throwaways');
  const desktopJunctionPath = path.join(homeDir, 'Desktop', 'Projects');

  return {
    projectsRoot,
    throwawaysRoot,
    desktopJunctionPath,
    defaultTtlDays: DEFAULT_TTL_DAYS,
  };
}

/**
 * Validates partial configuration updates.
 */
function validateConfig(config: Partial<ProjConfig>): void {
  if (config.projectsRoot !== undefined) {
    if (typeof config.projectsRoot !== 'string' || config.projectsRoot.trim() === '') {
      throw new Error('Invalid configuration: projectsRoot must be a non-empty string');
    }
  }

  if (config.throwawaysRoot !== undefined) {
    if (typeof config.throwawaysRoot !== 'string' || config.throwawaysRoot.trim() === '') {
      throw new Error('Invalid configuration: throwawaysRoot must be a non-empty string');
    }
  }

  if (config.desktopJunctionPath !== undefined) {
    if (typeof config.desktopJunctionPath !== 'string' || config.desktopJunctionPath.trim() === '') {
      throw new Error('Invalid configuration: desktopJunctionPath must be a non-empty string');
    }
  }

  if (config.defaultTtlDays !== undefined) {
    if (
      typeof config.defaultTtlDays !== 'number' ||
      !Number.isFinite(config.defaultTtlDays) ||
      config.defaultTtlDays <= 0
    ) {
      throw new Error('Invalid configuration: defaultTtlDays must be a positive number');
    }
  }
}

/**
 * Ensures ~/.proj and ~/.proj/templates directories exist,
 * and copies default AGENTS.md and gitignore.default templates if missing.
 * Also creates default config.json if not present.
 */
export function ensureConfigDirs(options?: ConfigOptions): {
  configDir: string;
  templatesDir: string;
  configFile: string;
} {
  const configDir = getConfigDir(options?.configDir);
  const templatesDir = getTemplatesDir(options?.configDir);
  const configFile = getConfigFile(options?.configDir);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
  }

  const agentsPath = path.join(templatesDir, DEFAULT_AGENTS_TEMPLATE_NAME);
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, DEFAULT_AGENTS_TEMPLATE, 'utf8');
  }

  const gitignorePath = path.join(templatesDir, DEFAULT_GITIGNORE_TEMPLATE_NAME);
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, DEFAULT_GITIGNORE_TEMPLATE, 'utf8');
  }

  if (!fs.existsSync(configFile)) {
    const defaults = getDefaultConfig();
    fs.writeFileSync(configFile, JSON.stringify(defaults, null, 2) + '\n', 'utf8');
  }

  return {
    configDir,
    templatesDir,
    configFile,
  };
}

/**
 * Loads configuration from config.json.
 * Validates, merges with defaults, and handles corrupt files safely.
 */
export function getConfig(options?: ConfigOptions): ProjConfig {
  ensureConfigDirs(options);
  const configFile = getConfigFile(options?.configDir);

  let rawConfig: Record<string, unknown> = {};
  try {
    const content = fs.readFileSync(configFile, 'utf8');
    rawConfig = JSON.parse(content);
    if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
      rawConfig = {};
    }
  } catch {
    // Malformed JSON - safely fallback to defaults without corrupting
    rawConfig = {};
  }

  const defaults = getDefaultConfig();
  const projectsRoot =
    typeof rawConfig.projectsRoot === 'string' && rawConfig.projectsRoot.trim() !== ''
      ? rawConfig.projectsRoot
      : defaults.projectsRoot;

  const throwawaysRoot =
    typeof rawConfig.throwawaysRoot === 'string' && rawConfig.throwawaysRoot.trim() !== ''
      ? rawConfig.throwawaysRoot
      : path.join(projectsRoot, 'throwaways');

  const desktopJunctionPath =
    typeof rawConfig.desktopJunctionPath === 'string' && rawConfig.desktopJunctionPath.trim() !== ''
      ? rawConfig.desktopJunctionPath
      : defaults.desktopJunctionPath;

  const defaultTtlDays =
    typeof rawConfig.defaultTtlDays === 'number' && rawConfig.defaultTtlDays > 0
      ? rawConfig.defaultTtlDays
      : defaults.defaultTtlDays;

  return {
    ...defaults,
    ...rawConfig,
    projectsRoot,
    throwawaysRoot,
    desktopJunctionPath,
    defaultTtlDays,
  };
}

/**
 * Updates configuration settings and persists to config.json.
 */
export function updateConfig(
  updates: Partial<ProjConfig>,
  options?: ConfigOptions
): ProjConfig {
  validateConfig(updates);

  const current = getConfig(options);
  const merged: ProjConfig = {
    ...current,
    ...updates,
  };

  const configFile = getConfigFile(options?.configDir);
  const configDir = getConfigDir(options?.configDir);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}
