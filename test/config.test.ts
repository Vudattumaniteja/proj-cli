import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getConfig,
  updateConfig,
  ensureConfigDirs,
  getDefaultConfig,
  getConfigDir,
  getTemplatesDir,
  getConfigFile,
  getIpcFile,
  DEFAULT_AGENTS_TEMPLATE,
  DEFAULT_GITIGNORE_TEMPLATE,
} from '../src/config/index.js';

describe('Configuration Manager', () => {
  let tempDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    // Create an isolated temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-config-'));
    process.env.PROJ_CONFIG_DIR = tempDir;
  });

  afterEach(() => {
    // Restore environment variable
    if (originalEnvConfigDir !== undefined) {
      process.env.PROJ_CONFIG_DIR = originalEnvConfigDir;
    } else {
      delete process.env.PROJ_CONFIG_DIR;
    }
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Default configuration & constants', () => {
    it('provides correct default paths based on home directory', () => {
      const home = os.homedir();
      const defaults = getDefaultConfig();

      expect(defaults.projectsRoot).toBe(path.join(home, 'projects'));
      expect(defaults.throwawaysRoot).toBe(path.join(home, 'projects', 'throwaways'));
      expect(defaults.desktopJunctionPath).toBe(path.join(home, 'Desktop', 'Projects'));
      expect(defaults.defaultTtlDays).toBe(3);
    });

    it('resolves config paths correctly using PROJ_CONFIG_DIR when set', () => {
      expect(getConfigDir()).toBe(tempDir);
      expect(getTemplatesDir()).toBe(path.join(tempDir, 'templates'));
      expect(getConfigFile()).toBe(path.join(tempDir, 'config.json'));
      expect(getIpcFile()).toBe(path.join(tempDir, 'ipc.json'));
    });

    it('resolves config paths to ~/.proj by default when env var not set', () => {
      delete process.env.PROJ_CONFIG_DIR;
      const expectedBase = path.join(os.homedir(), '.proj');
      expect(getConfigDir()).toBe(expectedBase);
      expect(getTemplatesDir()).toBe(path.join(expectedBase, 'templates'));
      expect(getConfigFile()).toBe(path.join(expectedBase, 'config.json'));
      expect(getIpcFile()).toBe(path.join(expectedBase, 'ipc.json'));
    });

    it('supports custom config directory passed as argument to path helpers', () => {
      const customPath = path.join(tempDir, 'explicit-dir');
      expect(getConfigDir(customPath)).toBe(path.resolve(customPath));
      expect(getTemplatesDir(customPath)).toBe(path.join(path.resolve(customPath), 'templates'));
      expect(getConfigFile(customPath)).toBe(path.join(path.resolve(customPath), 'config.json'));
      expect(getIpcFile(customPath)).toBe(path.join(path.resolve(customPath), 'ipc.json'));
    });
  });

  describe('ensureConfigDirs()', () => {
    it('creates ~/.proj and ~/.proj/templates directories and default template files', () => {
      const templatesDir = path.join(tempDir, 'templates');
      const agentsFile = path.join(templatesDir, 'AGENTS.md');
      const gitignoreFile = path.join(templatesDir, 'gitignore.default');
      const configFile = path.join(tempDir, 'config.json');

      expect(fs.existsSync(tempDir)).toBe(true);
      expect(fs.existsSync(templatesDir)).toBe(false);

      const result = ensureConfigDirs();

      expect(result.configDir).toBe(tempDir);
      expect(result.templatesDir).toBe(templatesDir);
      expect(result.configFile).toBe(configFile);

      expect(fs.existsSync(templatesDir)).toBe(true);
      expect(fs.existsSync(agentsFile)).toBe(true);
      expect(fs.existsSync(gitignoreFile)).toBe(true);
      expect(fs.existsSync(configFile)).toBe(true);

      expect(fs.readFileSync(agentsFile, 'utf8')).toBe(DEFAULT_AGENTS_TEMPLATE);
      expect(fs.readFileSync(gitignoreFile, 'utf8')).toBe(DEFAULT_GITIGNORE_TEMPLATE);
    });

    it('supports options.configDir parameter explicitly', () => {
      const explicitDir = path.join(tempDir, 'explicit-target');
      ensureConfigDirs({ configDir: explicitDir });

      expect(fs.existsSync(explicitDir)).toBe(true);
      expect(fs.existsSync(path.join(explicitDir, 'templates', 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(explicitDir, 'templates', 'gitignore.default'))).toBe(true);
      expect(fs.existsSync(path.join(explicitDir, 'config.json'))).toBe(true);
    });

    it('does not overwrite existing templates if they already exist', () => {
      const templatesDir = path.join(tempDir, 'templates');
      fs.mkdirSync(templatesDir, { recursive: true });

      const customAgents = '# Custom AGENTS.md';
      const customGitignore = '# Custom gitignore';
      const agentsFile = path.join(templatesDir, 'AGENTS.md');
      const gitignoreFile = path.join(templatesDir, 'gitignore.default');

      fs.writeFileSync(agentsFile, customAgents, 'utf8');
      fs.writeFileSync(gitignoreFile, customGitignore, 'utf8');

      ensureConfigDirs();

      expect(fs.readFileSync(agentsFile, 'utf8')).toBe(customAgents);
      expect(fs.readFileSync(gitignoreFile, 'utf8')).toBe(customGitignore);
    });
  });

  describe('getConfig()', () => {
    it('returns default configuration if config.json does not exist and creates it', () => {
      const config = getConfig();

      expect(config.projectsRoot).toBe(path.join(os.homedir(), 'projects'));
      expect(config.throwawaysRoot).toBe(path.join(os.homedir(), 'projects', 'throwaways'));
      expect(config.defaultTtlDays).toBe(3);

      const configFile = path.join(tempDir, 'config.json');
      expect(fs.existsSync(configFile)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      expect(saved.projectsRoot).toBe(config.projectsRoot);
    });

    it('reads custom values from existing config.json and merges missing defaults', () => {
      const configFile = path.join(tempDir, 'config.json');
      const customProjects = path.join(tempDir, 'my-custom-projects');
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          projectsRoot: customProjects,
        }),
        'utf8'
      );

      const config = getConfig();
      expect(config.projectsRoot).toBe(customProjects);
      // throwawaysRoot defaults relative to projectsRoot or default
      expect(config.throwawaysRoot).toBe(path.join(customProjects, 'throwaways'));
      expect(config.defaultTtlDays).toBe(3);
    });

    it('safely handles corrupted or invalid JSON by returning default config without crashing', () => {
      const configFile = path.join(tempDir, 'config.json');
      fs.writeFileSync(configFile, 'invalid json content { [', 'utf8');

      const config = getConfig();
      expect(config.projectsRoot).toBe(path.join(os.homedir(), 'projects'));
      expect(config.throwawaysRoot).toBe(path.join(os.homedir(), 'projects', 'throwaways'));
    });

    it('handles non-object JSON values (arrays, primitives) safely', () => {
      const configFile = path.join(tempDir, 'config.json');
      fs.writeFileSync(configFile, JSON.stringify([1, 2, 3]), 'utf8');

      const config = getConfig();
      expect(config.projectsRoot).toBe(path.join(os.homedir(), 'projects'));
      expect(config.throwawaysRoot).toBe(path.join(os.homedir(), 'projects', 'throwaways'));
    });
  });

  describe('updateConfig()', () => {
    it('updates specific configuration keys and persists to disk safely', () => {
      const customProjects = path.join(tempDir, 'workspace');
      const customThrowaways = path.join(tempDir, 'scratch');

      const updated = updateConfig({
        projectsRoot: customProjects,
        throwawaysRoot: customThrowaways,
        defaultTtlDays: 7,
      });

      expect(updated.projectsRoot).toBe(customProjects);
      expect(updated.throwawaysRoot).toBe(customThrowaways);
      expect(updated.defaultTtlDays).toBe(7);

      // Verify persistence on disk
      const configFile = path.join(tempDir, 'config.json');
      const onDisk = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      expect(onDisk.projectsRoot).toBe(customProjects);
      expect(onDisk.throwawaysRoot).toBe(customThrowaways);
      expect(onDisk.defaultTtlDays).toBe(7);

      // Verify subsequent getConfig reads the updated config
      const reloaded = getConfig();
      expect(reloaded.projectsRoot).toBe(customProjects);
      expect(reloaded.throwawaysRoot).toBe(customThrowaways);
      expect(reloaded.defaultTtlDays).toBe(7);
    });

    it('partially updates configuration preserving other existing keys and custom properties', () => {
      updateConfig({
        defaultTtlDays: 14,
        customKey: 'customValue',
      });

      const updated2 = updateConfig({
        projectsRoot: path.join(tempDir, 'new-projects'),
      });

      expect(updated2.defaultTtlDays).toBe(14);
      expect(updated2.projectsRoot).toBe(path.join(tempDir, 'new-projects'));
      expect(updated2.customKey).toBe('customValue');
    });

    it('validates schema and rejects invalid property types', () => {
      expect(() => {
        updateConfig({ defaultTtlDays: -5 });
      }).toThrow('defaultTtlDays');

      expect(() => {
        updateConfig({ defaultTtlDays: 'invalid' as unknown as number });
      }).toThrow('defaultTtlDays');

      expect(() => {
        updateConfig({ projectsRoot: '' });
      }).toThrow('projectsRoot');

      expect(() => {
        updateConfig({ projectsRoot: 123 as unknown as string });
      }).toThrow('projectsRoot');

      expect(() => {
        updateConfig({ throwawaysRoot: '   ' });
      }).toThrow('throwawaysRoot');

      expect(() => {
        updateConfig({ desktopJunctionPath: null as unknown as string });
      }).toThrow('desktopJunctionPath');
    });
  });
});
