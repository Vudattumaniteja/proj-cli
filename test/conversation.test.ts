import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import { simpleGit } from 'simple-git';
import {
  createConversation,
  pruneExpiredSilently,
  createThrowaway,
  checkExpiredThrowaways,
  type ThrowawayRecord,
} from '../src/engine/throwaway.js';
import { getConfig, updateConfig, ensureConfigDirs } from '../src/config/index.js';
import { readIpcToken } from '../src/ipc/index.js';

describe('Conversation Engine (createConversation & pruneExpiredSilently)', () => {
  let tempRoot: string;
  let projectsDir: string;
  let throwawaysDir: string;
  let configDir: string;
  let originalEnvConfigDir: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-conv-'));
    projectsDir = path.join(tempRoot, 'projects');
    throwawaysDir = path.join(projectsDir, 'throwaways');
    configDir = path.join(tempRoot, '.proj');
    originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;
    process.env.PROJ_CONFIG_DIR = configDir;

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
    if (originalEnvConfigDir !== undefined) {
      process.env.PROJ_CONFIG_DIR = originalEnvConfigDir;
    } else {
      delete process.env.PROJ_CONFIG_DIR;
    }
    vi.restoreAllMocks();
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('createConversation()', () => {
    it('auto-generates conversation-YYYY-MM-DD-HHmm when name is omitted', async () => {
      const fixedDate = new Date(2026, 8, 25, 14, 30); // 2026-09-25 14:30 local
      const result = await createConversation(undefined, {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: fixedDate,
      });

      expect(result.name).toBe('conversation-2026-09-25-1430');
      expect(result.path).toBe(path.join(throwawaysDir, 'conversation-2026-09-25-1430'));
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it('defaults to 1-day TTL (24 hours) regardless of config defaultTtlDays', async () => {
      const fixedDate = new Date('2026-09-25T10:00:00.000Z');
      const result = await createConversation('one-day-chat', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: fixedDate,
      });

      expect(result.ttlDays).toBe(1);
      expect(result.createdAt).toBe('2026-09-25T10:00:00.000Z');
      expect(result.expiresAt).toBe('2026-09-26T10:00:00.000Z');
    });

    it('initializes Git repository, creates checkpoint commit, and writes AGENTS.md', async () => {
      const result = await createConversation('git-chat', {
        configDir,
        throwawaysRoot: throwawaysDir,
      });

      // Verify files exist
      expect(fs.existsSync(path.join(result.path, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.path, '.gitignore'))).toBe(true);
      expect(fs.existsSync(path.join(result.path, 'README.md'))).toBe(true);

      // Verify Git initialized and committed
      const git = simpleGit(result.path);
      const isRepo = await git.checkIsRepo();
      expect(isRepo).toBe(true);

      const log = await git.log();
      expect(log.total).toBe(1);
      expect(log.latest?.message).toContain('checkpoint:');
    });

    it('registers metadata in config and emits IPC cd token', async () => {
      const result = await createConversation('ipc-chat', {
        configDir,
        throwawaysRoot: throwawaysDir,
      });

      const config = getConfig({ configDir });
      expect(config.throwaways).toBeDefined();
      expect(config.throwaways!['ipc-chat']).toBeDefined();
      expect(config.throwaways!['ipc-chat'].path).toBe(result.path);

      // Verify IPC cd token
      const token = readIpcToken({ configDir });
      expect(token).not.toBeNull();
      expect(token?.action).toBe('cd');
      expect(token?.targetPath).toBe(result.path);
    });

    it('accepts custom ttl and template options', async () => {
      const fixedDate = new Date('2026-09-25T12:00:00.000Z');
      const result = await createConversation('custom-chat', {
        ttl: 2,
        template: 'typescript',
        configDir,
        throwawaysRoot: throwawaysDir,
        now: fixedDate,
      });

      expect(result.ttlDays).toBe(2);
      expect(result.expiresAt).toBe('2026-09-27T12:00:00.000Z');
      expect(fs.existsSync(path.join(result.path, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(result.path, 'tsconfig.json'))).toBe(true);
    });

    it('launches agy when launchAgy: true is provided', async () => {
      const spawnSpy = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as any);

      const result = await createConversation('agy-chat', {
        configDir,
        throwawaysRoot: throwawaysDir,
        launchAgy: true,
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        'agy',
        [],
        expect.objectContaining({
          cwd: result.path,
          stdio: 'inherit',
          shell: true,
        })
      );
    });

    it('does not launch agy when launchAgy is false or omitted', async () => {
      const spawnSpy = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as any);

      await createConversation('no-agy-chat', {
        configDir,
        throwawaysRoot: throwawaysDir,
        launchAgy: false,
      });

      expect(spawnSpy).not.toHaveBeenCalled();
    });
  });

  describe('pruneExpiredSilently()', () => {
    it('silently removes expired throwaway scratchpads and cleans config without throwing', async () => {
      const baseTime = new Date('2026-09-20T12:00:00.000Z');
      // Create expired throwaways
      const exp1 = await createThrowaway('old-conv-1', 1, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: baseTime,
      });
      const exp2 = await createThrowaway('old-conv-2', 2, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: baseTime,
      });
      // Create active throwaway
      const active = await createThrowaway('active-conv', 10, 'minimal', {
        configDir,
        throwawaysRoot: throwawaysDir,
        now: baseTime,
      });

      expect(fs.existsSync(exp1.path)).toBe(true);
      expect(fs.existsSync(exp2.path)).toBe(true);
      expect(fs.existsSync(active.path)).toBe(true);

      const pruned = pruneExpiredSilently({
        configDir,
        throwawaysRoot: throwawaysDir,
        now: new Date('2026-09-24T12:00:00.000Z'),
      });

      expect(pruned).toHaveLength(2);
      const prunedNames = pruned.map((p) => p.name);
      expect(prunedNames).toContain('old-conv-1');
      expect(prunedNames).toContain('old-conv-2');

      expect(fs.existsSync(exp1.path)).toBe(false);
      expect(fs.existsSync(exp2.path)).toBe(false);
      expect(fs.existsSync(active.path)).toBe(true);

      const cfg = getConfig({ configDir });
      expect(cfg.throwaways?.['old-conv-1']).toBeUndefined();
      expect(cfg.throwaways?.['old-conv-2']).toBeUndefined();
      expect(cfg.throwaways?.['active-conv']).toBeDefined();
    });

    it('handles non-existent paths and config corruptions without throwing or logging errors', () => {
      updateConfig(
        {
          throwaways: {
            'ghost-conv': {
              name: 'ghost-conv',
              path: path.join(throwawaysDir, 'does-not-exist'),
              createdAt: '2020-01-01T00:00:00.000Z',
              expiresAt: '2020-01-02T00:00:00.000Z',
              ttlDays: 1,
            },
          },
        },
        { configDir }
      );

      expect(() => {
        const pruned = pruneExpiredSilently({ configDir, throwawaysRoot: throwawaysDir });
        expect(pruned.length).toBeGreaterThanOrEqual(1);
      }).not.toThrow();

      const cfg = getConfig({ configDir });
      expect(cfg.throwaways?.['ghost-conv']).toBeUndefined();
    });
  });
});
