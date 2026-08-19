import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import {
  createThrowaway,
  checkExpiredThrowaways,
  graduateThrowaway,
  extendThrowaway,
  deleteThrowaway,
  type ThrowawayRecord,
} from '../src/engine/throwaway.js';
import { listProjects } from '../src/engine/discovery.js';
import { getConfig, updateConfig, ensureConfigDirs } from '../src/config/index.js';

describe('Throwaway Scratchpad Lifecycle Engine', () => {
  let tempRoot: string;
  let projectsDir: string;
  let throwawaysDir: string;
  let configDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-throwaway-'));
    projectsDir = path.join(tempRoot, 'projects');
    throwawaysDir = path.join(projectsDir, 'throwaways');
    configDir = path.join(tempRoot, '.proj');

    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(throwawaysDir, { recursive: true });
    ensureConfigDirs({ configDir });

    updateConfig(
      {
        projectsRoot: projectsDir,
        throwawaysRoot: throwawaysDir,
        defaultTtlDays: 3,
      },
      { configDir }
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('createThrowaway()', () => {
    it('creates a scratchpad folder under projects/throwaways/<name>', async () => {
      const fixedNow = new Date('2026-08-19T12:00:00.000Z');
      const result = await createThrowaway('quick-spike', 3, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: fixedNow,
      });

      expect(result.name).toBe('quick-spike');
      expect(result.path).toBe(path.join(throwawaysDir, 'quick-spike'));
      expect(result.ttlDays).toBe(3);
      expect(result.createdAt).toBe('2026-08-19T12:00:00.000Z');
      expect(result.expiresAt).toBe('2026-08-22T12:00:00.000Z');
      expect(result.template).toBe('minimal');

      // Verify folder and files exist
      expect(fs.existsSync(result.path)).toBe(true);
      expect(fs.existsSync(path.join(result.path, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.path, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.path, '.gitignore'))).toBe(true);
    });

    it('registers throwaway metadata in ~/.proj/config.json', async () => {
      const fixedNow = new Date('2026-08-19T10:00:00.000Z');
      await createThrowaway('proto-api', 5, 'typescript', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: fixedNow,
      });

      const config = getConfig({ configDir });
      expect(config.throwaways).toBeDefined();
      expect(config.throwaways!['proto-api']).toBeDefined();

      const meta = config.throwaways!['proto-api'];
      expect(meta.name).toBe('proto-api');
      expect(meta.path).toBe(path.join(throwawaysDir, 'proto-api'));
      expect(meta.createdAt).toBe('2026-08-19T10:00:00.000Z');
      expect(meta.expiresAt).toBe('2026-08-24T10:00:00.000Z');
      expect(meta.ttlDays).toBe(5);
      expect(meta.template).toBe('typescript');

      // Verify typescript starter files were generated
      expect(fs.existsSync(path.join(meta.path, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(meta.path, 'tsconfig.json'))).toBe(true);
      expect(fs.existsSync(path.join(meta.path, 'src', 'index.ts'))).toBe(true);
    });

    it('falls back to defaultTtlDays and minimal template when not specified', async () => {
      const fixedNow = new Date('2026-08-19T00:00:00.000Z');
      const result = await createThrowaway('default-scratch', undefined as any, undefined, {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: fixedNow,
      });

      expect(result.ttlDays).toBe(3);
      expect(result.expiresAt).toBe('2026-08-22T00:00:00.000Z');
      expect(result.template).toBe('minimal');
    });

    it('rejects invalid project names and duplicate scratchpads', async () => {
      await expect(
        createThrowaway('', 3, 'minimal', { configDir, throwawaysRoot: throwawaysDir })
      ).rejects.toThrow(/project name cannot be empty/i);

      await expect(
        createThrowaway('bad/name', 3, 'minimal', { configDir, throwawaysRoot: throwawaysDir })
      ).rejects.toThrow(/invalid project name/i);

      await createThrowaway('existing-scratch', 3, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
      });

      await expect(
        createThrowaway('existing-scratch', 3, 'minimal', {
          configDir,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('rejects invalid TTL values', async () => {
      await expect(
        createThrowaway('bad-ttl-1', -1, 'minimal', { configDir, throwawaysRoot: throwawaysDir })
      ).rejects.toThrow(/ttl/i);

      await expect(
        createThrowaway('bad-ttl-2', 0, 'minimal', { configDir, throwawaysRoot: throwawaysDir })
      ).rejects.toThrow(/ttl/i);
    });
  });

  describe('checkExpiredThrowaways()', () => {
    it('returns empty list when no throwaways are expired', async () => {
      const now = new Date('2026-08-19T12:00:00.000Z');
      await createThrowaway('fresh-1', 2, 'minimal', { configDir, throwawaysRoot: throwawaysDir, now });
      await createThrowaway('fresh-2', 5, 'minimal', { configDir, throwawaysRoot: throwawaysDir, now });

      const expired = checkExpiredThrowaways({
        configDir,
        now: new Date('2026-08-20T12:00:00.000Z'),
      });

      expect(expired).toHaveLength(0);
    });

    it('returns all records where now > expiresAt', async () => {
      const baseTime = new Date('2026-08-19T12:00:00.000Z');
      await createThrowaway('expired-1', 1, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: baseTime,
      }); // expires 2026-08-20T12:00:00.000Z
      await createThrowaway('expired-2', 2, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: baseTime,
      }); // expires 2026-08-21T12:00:00.000Z
      await createThrowaway('still-valid', 7, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: baseTime,
      }); // expires 2026-08-26T12:00:00.000Z

      const checkTime = new Date('2026-08-22T00:00:00.000Z');
      const expired = checkExpiredThrowaways({
        configDir,
        now: checkTime,
      });

      expect(expired).toHaveLength(2);
      const names = expired.map((e) => e.name);
      expect(names).toContain('expired-1');
      expect(names).toContain('expired-2');
      expect(names).not.toContain('still-valid');
    });
  });

  describe('extendThrowaway()', () => {
    it('extends the expiration date and ttlDays in configuration', async () => {
      const created = new Date('2026-08-19T12:00:00.000Z');
      await createThrowaway('extend-target', 3, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: created,
      });

      const updated = extendThrowaway('extend-target', 4, { configDir, throwawaysRoot: throwawaysDir });
      expect(updated.name).toBe('extend-target');
      expect(updated.ttlDays).toBe(7);
      expect(updated.expiresAt).toBe('2026-08-26T12:00:00.000Z');

      const config = getConfig({ configDir });
      expect(config.throwaways!['extend-target'].expiresAt).toBe('2026-08-26T12:00:00.000Z');
      expect(config.throwaways!['extend-target'].ttlDays).toBe(7);
    });

    it('rejects extension for non-existent throwaways or invalid days', async () => {
      expect(() =>
        extendThrowaway('non-existent', 2, { configDir, throwawaysRoot: throwawaysDir })
      ).toThrow(/not found/i);

      await createThrowaway('valid-item', 2, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
      });

      expect(() =>
        extendThrowaway('valid-item', -1, { configDir, throwawaysRoot: throwawaysDir })
      ).toThrow(/days/i);

      expect(() =>
        extendThrowaway('valid-item', 0, { configDir, throwawaysRoot: throwawaysDir })
      ).toThrow(/days/i);
    });
  });

  describe('deleteThrowaway()', () => {
    it('removes the scratchpad directory and deletes metadata from config.json', async () => {
      await createThrowaway('delete-me', 2, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
      });

      const scratchPath = path.join(throwawaysDir, 'delete-me');
      expect(fs.existsSync(scratchPath)).toBe(true);

      const result = deleteThrowaway('delete-me', { configDir, throwawaysRoot: throwawaysDir });
      expect(result.deleted).toBe(true);
      expect(result.name).toBe('delete-me');

      expect(fs.existsSync(scratchPath)).toBe(false);

      const config = getConfig({ configDir });
      expect(config.throwaways?.['delete-me']).toBeUndefined();
    });

    it('throws when attempting to delete non-existent scratchpad', () => {
      expect(() =>
        deleteThrowaway('ghost-scratch', { configDir, throwawaysRoot: throwawaysDir })
      ).toThrow(/not found|does not exist/i);
    });
  });

  describe('graduateThrowaway()', () => {
    it('migrates scratchpad to canonical projects root, initializes Git, and updates config', async () => {
      await createThrowaway('promoted-poc', 3, 'typescript', {
        configDir,
        throwawaysRoot: throwawaysDir,
      });

      const srcDir = path.join(throwawaysDir, 'promoted-poc');
      const destDir = path.join(projectsDir, 'promoted-poc');

      expect(fs.existsSync(srcDir)).toBe(true);
      expect(fs.existsSync(destDir)).toBe(false);

      const result = await graduateThrowaway('promoted-poc', {
        configDir,
        projectsRoot: projectsDir,
        throwawaysRoot: throwawaysDir,
      });

      expect(result.name).toBe('promoted-poc');
      expect(result.path).toBe(destDir);
      expect(fs.existsSync(srcDir)).toBe(false);
      expect(fs.existsSync(destDir)).toBe(true);

      // Verify files migrated
      expect(fs.existsSync(path.join(destDir, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'tsconfig.json'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'src', 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'AGENTS.md'))).toBe(true);

      // Verify Git initialized and snapshot commit created
      const git = simpleGit(destDir);
      const isRepo = await git.checkIsRepo();
      expect(isRepo).toBe(true);

      const log = await git.log();
      expect(log.total).toBeGreaterThanOrEqual(1);
      expect(log.latest?.message).toContain('checkpoint: Graduated from throwaway scratchpad');

      // Verify metadata cleaned from config.json
      const config = getConfig({ configDir });
      expect(config.throwaways?.['promoted-poc']).toBeUndefined();

      // Verify listProjects now reports isThrowaway: false
      const allProjects = await listProjects(projectsDir, { throwawaysRoot: throwawaysDir });
      const found = allProjects.find((p) => p.name === 'promoted-poc');
      expect(found).toBeDefined();
      expect(found!.isThrowaway).toBe(false);
      expect(found!.isGit).toBe(true);
    });

    it('rejects graduation if scratchpad does not exist', async () => {
      await expect(
        graduateThrowaway('missing-poc', {
          configDir,
          projectsRoot: projectsDir,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/does not exist|not found/i);
    });

    it('rejects graduation if destination path already exists in canonical projects root', async () => {
      await createThrowaway('conflict-poc', 3, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
      });

      // Pre-create destination in projectsDir
      fs.mkdirSync(path.join(projectsDir, 'conflict-poc'));

      await expect(
        graduateThrowaway('conflict-poc', {
          configDir,
          projectsRoot: projectsDir,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/already exists/i);
    });
  });
});
