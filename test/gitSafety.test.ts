import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  createCheckpoint,
  listCheckpoints,
  rollbackCheckpoint,
  formatCheckpointsTable,
  formatRollbackSummary,
  SAFETY_STASH_PREFIX,
} from '../src/engine/gitSafety.js';

describe('Git Safety Engine (Checkpoints & Undo Rollbacks)', () => {
  let tempDir: string;
  let repoDir: string;
  let git: SimpleGit;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-gitsafety-'));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });

    git = simpleGit(repoDir);
    await git.init();
    await git.addConfig('user.name', 'SafetyTester');
    await git.addConfig('user.email', 'tester@proj.local');

    // Initial base commit
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Base Project\n', 'utf8');
    await git.add('.');
    await git.commit('checkpoint: Initial project setup');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('createCheckpoint()', () => {
    it('throws an error if target directory is not a Git repository', async () => {
      const nonRepo = path.join(tempDir, 'non-repo');
      fs.mkdirSync(nonRepo, { recursive: true });

      await expect(createCheckpoint(nonRepo, 'test')).rejects.toThrow(/not a git repository/i);
    });

    it('throws an error if checkpoint message is empty or whitespace', async () => {
      await expect(createCheckpoint(repoDir, '')).rejects.toThrow(/checkpoint message cannot be empty/i);
      await expect(createCheckpoint(repoDir, '   ')).rejects.toThrow(/checkpoint message cannot be empty/i);
    });

    it('stages all changes and creates a commit formatted as "checkpoint: <message>"', async () => {
      fs.writeFileSync(path.join(repoDir, 'file1.txt'), 'hello world', 'utf8');
      fs.mkdirSync(path.join(repoDir, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'sub', 'file2.txt'), 'nested content', 'utf8');

      const result = await createCheckpoint(repoDir, 'added feature files');

      expect(result.message).toBe('checkpoint: added feature files');
      expect(result.hash).toBeDefined();
      expect(result.shortHash).toHaveLength(7);
      expect(result.filesChanged).toBeGreaterThanOrEqual(2);

      const log = await git.log();
      expect(log.latest?.message).toBe('checkpoint: added feature files');
      expect(log.latest?.hash).toBe(result.hash);

      const status = await git.status();
      expect(status.isClean()).toBe(true);
    });

    it('handles messages that already contain the "checkpoint:" prefix without duplicating it', async () => {
      fs.writeFileSync(path.join(repoDir, 'file3.txt'), 'content 3', 'utf8');

      const result = await createCheckpoint(repoDir, 'checkpoint: manual save');
      expect(result.message).toBe('checkpoint: manual save');

      const log = await git.log();
      expect(log.latest?.message).toBe('checkpoint: manual save');
    });

    it('throws descriptive error if working directory has no changes to commit', async () => {
      await expect(createCheckpoint(repoDir, 'no changes')).rejects.toThrow(/no changes to commit/i);
    });
  });

  describe('listCheckpoints()', () => {
    it('throws an error if target directory is not a Git repository', async () => {
      const nonRepo = path.join(tempDir, 'non-repo');
      fs.mkdirSync(nonRepo, { recursive: true });

      await expect(listCheckpoints(nonRepo)).rejects.toThrow(/not a git repository/i);
    });

    it('retrieves checkpoint commits with hash, shortHash, message, and relative timestamp', async () => {
      // Create additional checkpoint commits
      fs.writeFileSync(path.join(repoDir, 'step1.txt'), 'step 1', 'utf8');
      await createCheckpoint(repoDir, 'completed step 1');

      fs.writeFileSync(path.join(repoDir, 'step2.txt'), 'step 2', 'utf8');
      await createCheckpoint(repoDir, 'completed step 2');

      // Also create a non-checkpoint commit to verify filtering
      fs.writeFileSync(path.join(repoDir, 'regular.txt'), 'regular work', 'utf8');
      await git.add('.');
      await git.commit('feat: non checkpoint commit');

      const checkpoints = await listCheckpoints(repoDir);

      // Should only contain the 3 checkpoint commits (latest first)
      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0].message).toBe('checkpoint: completed step 2');
      expect(checkpoints[1].message).toBe('checkpoint: completed step 1');
      expect(checkpoints[2].message).toBe('checkpoint: Initial project setup');

      expect(checkpoints[0].hash).toBeDefined();
      expect(checkpoints[0].shortHash).toBeDefined();
      expect(checkpoints[0].relativeTimestamp).toBeDefined();
      expect(checkpoints[0].timestamp).toBeInstanceOf(Date);
    });

    it('respects the limit argument', async () => {
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(path.join(repoDir, `f${i}.txt`), `content ${i}`, 'utf8');
        await createCheckpoint(repoDir, `checkpoint ${i}`);
      }

      const limited = await listCheckpoints(repoDir, 3);
      expect(limited).toHaveLength(3);
      expect(limited[0].message).toBe('checkpoint: checkpoint 5');
    });
  });

  describe('rollbackCheckpoint()', () => {
    it('throws an error if target directory is not a Git repository', async () => {
      const nonRepo = path.join(tempDir, 'non-repo');
      fs.mkdirSync(nonRepo, { recursive: true });

      await expect(rollbackCheckpoint(nonRepo)).rejects.toThrow(/not a git repository/i);
    });

    it('rolls back to previous checkpoint when targetCommitHash is omitted', async () => {
      fs.writeFileSync(path.join(repoDir, 'v1.txt'), 'version 1', 'utf8');
      const cp1 = await createCheckpoint(repoDir, 'checkpoint 1');

      fs.writeFileSync(path.join(repoDir, 'v2.txt'), 'version 2', 'utf8');
      await createCheckpoint(repoDir, 'checkpoint 2');

      expect(fs.existsSync(path.join(repoDir, 'v2.txt'))).toBe(true);

      const rollback = await rollbackCheckpoint(repoDir);

      expect(rollback.success).toBe(true);
      expect(rollback.targetHash).toBe(cp1.hash);
      expect(rollback.targetMessage).toBe('checkpoint: checkpoint 1');
      expect(fs.existsSync(path.join(repoDir, 'v1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'v2.txt'))).toBe(false);

      const log = await git.log();
      expect(log.latest?.hash).toBe(cp1.hash);
    });

    it('rolls back to a specific target commit hash', async () => {
      const initialLog = await git.log();
      const initialHash = initialLog.latest!.hash;

      fs.writeFileSync(path.join(repoDir, 'c1.txt'), 'c1', 'utf8');
      const cp1 = await createCheckpoint(repoDir, 'c1');

      fs.writeFileSync(path.join(repoDir, 'c2.txt'), 'c2', 'utf8');
      await createCheckpoint(repoDir, 'c2');

      const rollback = await rollbackCheckpoint(repoDir, initialHash);

      expect(rollback.success).toBe(true);
      expect(rollback.targetHash).toBe(initialHash);
      expect(fs.existsSync(path.join(repoDir, 'c1.txt'))).toBe(false);
      expect(fs.existsSync(path.join(repoDir, 'c2.txt'))).toBe(false);
      expect(fs.existsSync(path.join(repoDir, 'README.md'))).toBe(true);
    });

    it('automatically creates a named safety stash (proj-safety-stash-<timestamp>) when working tree is dirty before reset', async () => {
      fs.writeFileSync(path.join(repoDir, 'saved.txt'), 'saved', 'utf8');
      const cp = await createCheckpoint(repoDir, 'saved file');

      // Dirty uncommitted and untracked changes
      fs.writeFileSync(path.join(repoDir, 'modified.txt'), 'uncommitted', 'utf8');
      fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'untracked secret work', 'utf8');

      const statusBefore = await git.status();
      expect(statusBefore.isClean()).toBe(false);

      const rollback = await rollbackCheckpoint(repoDir, cp.hash);

      expect(rollback.stashCreated).toBe(true);
      expect(rollback.stashName).toMatch(new RegExp(`^${SAFETY_STASH_PREFIX}`));
      expect(rollback.stashRef).toBeDefined();

      // Working tree should now be clean and match checkpoint commit
      const statusAfter = await git.status();
      expect(statusAfter.isClean()).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'untracked.txt'))).toBe(false);

      // Verify that the stash actually exists in Git
      const stashList = await git.stashList();
      expect(stashList.total).toBeGreaterThanOrEqual(1);
      const matchedStash = stashList.all.find((s) => s.message.includes(rollback.stashName!));
      expect(matchedStash).toBeDefined();
    });

    it('does not create a safety stash if the working tree is completely clean', async () => {
      const initialLog = await git.log();
      const initialHash = initialLog.latest!.hash;

      fs.writeFileSync(path.join(repoDir, 'file.txt'), 'content', 'utf8');
      await createCheckpoint(repoDir, 'file commit');

      const rollback = await rollbackCheckpoint(repoDir, initialHash);

      expect(rollback.stashCreated).toBe(false);
      expect(rollback.stashName).toBeNull();
      expect(rollback.stashRef).toBeNull();
    });

    it('provides rollback confirmation summary displaying reverted files and stash reference', async () => {
      fs.writeFileSync(path.join(repoDir, 'file_a.txt'), 'A', 'utf8');
      const cp = await createCheckpoint(repoDir, 'checkpoint A');

      fs.writeFileSync(path.join(repoDir, 'file_b.txt'), 'B', 'utf8');
      await createCheckpoint(repoDir, 'checkpoint B');

      // Add dirty uncommitted file
      fs.writeFileSync(path.join(repoDir, 'file_dirty.txt'), 'dirty', 'utf8');

      const rollback = await rollbackCheckpoint(repoDir, cp.hash);

      expect(rollback.revertedFiles).toContain('file_b.txt');
      expect(rollback.summary).toBeDefined();
      expect(rollback.summary).toContain('checkpoint: checkpoint A');
      expect(rollback.summary).toContain(rollback.stashName!);
    });

    it('throws an error if specified target commit hash does not exist', async () => {
      await expect(
        rollbackCheckpoint(repoDir, '0000000000000000000000000000000000000000')
      ).rejects.toThrow(/target commit .* not found/i);
    });
  });

  describe('Formatters', () => {
    it('formats checkpoints table clearly', () => {
      const table = formatCheckpointsTable([
        {
          hash: 'abcdef1234567890abcdef1234567890abcdef12',
          shortHash: 'abcdef1',
          message: 'checkpoint: initial scaffold',
          date: new Date(),
          timestamp: new Date(),
          relativeTimestamp: '2 minutes ago',
          relativeTime: '2 minutes ago',
          authorName: 'SafetyTester',
        },
      ]);

      expect(table).toContain('abcdef1');
      expect(table).toContain('checkpoint: initial scaffold');
      expect(table).toContain('2 minutes ago');
    });

    it('formats rollback summary with stash warning and reverted file list', () => {
      const formatted = formatRollbackSummary({
        success: true,
        targetHash: '1234567890abcdef1234567890abcdef12345678',
        targetShortHash: '1234567',
        targetMessage: 'checkpoint: safe state',
        stashCreated: true,
        stashName: 'proj-safety-stash-1700000000000',
        stashRef: 'stash@{0}',
        revertedFiles: ['src/bad.ts', 'temp.txt'],
        summary: 'Rollback complete',
      });

      expect(formatted).toContain('1234567');
      expect(formatted).toContain('checkpoint: safe state');
      expect(formatted).toContain('proj-safety-stash-1700000000000');
      expect(formatted).toContain('src/bad.ts');
    });
  });
});
