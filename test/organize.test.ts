import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import {
  moveProject,
  createGroup,
  deleteGroup,
  validateGroupName,
} from '../src/engine/organize.js';
import { scaffoldProject } from '../src/engine/scaffold.js';
import { ensureConfigDirs } from '../src/config/index.js';

describe('Project Organizer Engine (organize.ts)', () => {
  let tempRoot: string;
  let canonicalProjects: string;
  let throwawaysDir: string;
  let configDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-organize-'));
    canonicalProjects = path.join(tempRoot, 'projects');
    throwawaysDir = path.join(tempRoot, 'throwaways');
    configDir = path.join(tempRoot, '.proj');

    fs.mkdirSync(canonicalProjects, { recursive: true });
    fs.mkdirSync(throwawaysDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
        throwaways: {},
      }),
      'utf8'
    );

    ensureConfigDirs({ configDir });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('validateGroupName', () => {
    it('accepts valid alphanumeric and kebab-case group names', () => {
      expect(() => validateGroupName('hackathons')).not.toThrow();
      expect(() => validateGroupName('ai-tools')).not.toThrow();
      expect(() => validateGroupName('client_work_2026')).not.toThrow();
    });

    it('rejects empty or whitespace group names', () => {
      expect(() => validateGroupName('')).toThrow(/group name cannot be empty/i);
      expect(() => validateGroupName('   ')).toThrow(/group name cannot be empty/i);
    });

    it('rejects relative navigation dot names', () => {
      expect(() => validateGroupName('.')).toThrow(/cannot be "\." or "\.\."/i);
      expect(() => validateGroupName('..')).toThrow(/cannot be "\." or "\.\."/i);
    });

    it('rejects forbidden filesystem characters and slashes', () => {
      const invalid = ['foo/bar', 'foo\\bar', 'group:name', 'group*name', 'group?name', 'group"name', 'group<name', 'group>name', 'group|name'];
      for (const name of invalid) {
        expect(() => validateGroupName(name)).toThrow(/contains forbidden characters/i);
      }
    });

    it('rejects reserved folder names', () => {
      const reserved = ['throwaways', '.git', '.proj', 'node_modules', 'dist'];
      for (const name of reserved) {
        expect(() => validateGroupName(name)).toThrow(/reserved directory name/i);
      }
    });
  });

  describe('createGroup', () => {
    it('creates a new group directory in canonical projects root', async () => {
      const result = await createGroup('hackathons', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('hackathons');
      expect(result.path).toBe(path.resolve(path.join(canonicalProjects, 'hackathons')));
      expect(fs.existsSync(result.path)).toBe(true);
      expect(fs.statSync(result.path).isDirectory()).toBe(true);
    });

    it('rejects creating group if directory already exists', async () => {
      fs.mkdirSync(path.join(canonicalProjects, 'existing-group'));

      await expect(
        createGroup('existing-group', {
          configDir,
          projectsRoot: canonicalProjects,
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('rejects reserved group names on creation', async () => {
      await expect(
        createGroup('throwaways', {
          configDir,
          projectsRoot: canonicalProjects,
        })
      ).rejects.toThrow(/reserved directory name/i);
    });
  });

  describe('deleteGroup', () => {
    it('deletes an empty group directory', async () => {
      const groupDir = path.join(canonicalProjects, 'empty-group');
      fs.mkdirSync(groupDir);

      const result = await deleteGroup('empty-group', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('empty-group');
      expect(result.deleted).toBe(true);
      expect(fs.existsSync(groupDir)).toBe(false);
    });

    it('throws error when attempting to delete non-empty group without force', async () => {
      const groupDir = path.join(canonicalProjects, 'active-group');
      fs.mkdirSync(groupDir);
      fs.writeFileSync(path.join(groupDir, 'some-file.txt'), 'content');

      await expect(
        deleteGroup('active-group', {
          configDir,
          projectsRoot: canonicalProjects,
        })
      ).rejects.toThrow(/not empty/i);

      expect(fs.existsSync(groupDir)).toBe(true);
    });

    it('deletes non-empty group when force is true', async () => {
      const groupDir = path.join(canonicalProjects, 'force-group');
      fs.mkdirSync(groupDir);
      fs.writeFileSync(path.join(groupDir, 'some-file.txt'), 'content');

      const result = await deleteGroup('force-group', {
        configDir,
        projectsRoot: canonicalProjects,
        force: true,
      });

      expect(result.name).toBe('force-group');
      expect(result.deleted).toBe(true);
      expect(fs.existsSync(groupDir)).toBe(false);
    });

    it('throws error when group does not exist', async () => {
      await expect(
        deleteGroup('non-existent-group', {
          configDir,
          projectsRoot: canonicalProjects,
        })
      ).rejects.toThrow(/Cannot locate group/i);
    });
  });

  describe('moveProject', () => {
    it('moves a root standalone project into a group and auto-creates the group folder', async () => {
      await scaffoldProject('my-tool', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      const oldPath = path.join(canonicalProjects, 'my-tool');
      expect(fs.existsSync(oldPath)).toBe(true);

      const result = await moveProject('my-tool', 'utilities', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      const newPath = path.join(canonicalProjects, 'utilities', 'my-tool');
      expect(result.name).toBe('my-tool');
      expect(result.group).toBe('utilities');
      expect(result.previousGroup).toBeUndefined();
      expect(result.path).toBe(path.resolve(newPath));
      expect(result.previousPath).toBe(path.resolve(oldPath));

      expect(fs.existsSync(oldPath)).toBe(false);
      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.existsSync(path.join(newPath, 'package.json'))).toBe(true);
    });

    it('moves a grouped project to root workspace (targetGroup: null or "root")', async () => {
      await scaffoldProject('hackathons/bot', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      const oldPath = path.join(canonicalProjects, 'hackathons', 'bot');
      expect(fs.existsSync(oldPath)).toBe(true);

      const result = await moveProject('hackathons/bot', null, {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      const newPath = path.join(canonicalProjects, 'bot');
      expect(result.name).toBe('bot');
      expect(result.group).toBeUndefined();
      expect(result.previousGroup).toBe('hackathons');
      expect(result.path).toBe(path.resolve(newPath));

      expect(fs.existsSync(oldPath)).toBe(false);
      expect(fs.existsSync(newPath)).toBe(true);
    });

    it('moves a grouped project to root workspace using targetGroup: "root"', async () => {
      await scaffoldProject('ai-agents/agent-1', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      const result = await moveProject('agent-1', 'root', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      expect(result.name).toBe('agent-1');
      expect(result.group).toBeUndefined();
      expect(result.previousGroup).toBe('ai-agents');
      expect(fs.existsSync(path.join(canonicalProjects, 'agent-1'))).toBe(true);
    });

    it('moves a project from one group to another group', async () => {
      await scaffoldProject('group-a/shared-lib', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      const result = await moveProject('group-a/shared-lib', 'group-b', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      expect(result.name).toBe('shared-lib');
      expect(result.group).toBe('group-b');
      expect(result.previousGroup).toBe('group-a');
      expect(fs.existsSync(path.join(canonicalProjects, 'group-b', 'shared-lib'))).toBe(true);
      expect(fs.existsSync(path.join(canonicalProjects, 'group-a', 'shared-lib'))).toBe(false);
    });

    it('auto-prunes source group folder when the last project is moved out', async () => {
      await scaffoldProject('solo-group/only-child', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      const groupDir = path.join(canonicalProjects, 'solo-group');
      expect(fs.existsSync(groupDir)).toBe(true);

      await moveProject('solo-group/only-child', null, {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      expect(fs.existsSync(groupDir)).toBe(false);
    });

    it('does not prune source group folder when other projects remain', async () => {
      await scaffoldProject('multi-group/proj-1', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });
      await scaffoldProject('multi-group/proj-2', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      const groupDir = path.join(canonicalProjects, 'multi-group');

      await moveProject('multi-group/proj-1', 'other-group', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      expect(fs.existsSync(groupDir)).toBe(true);
      expect(fs.existsSync(path.join(groupDir, 'proj-2'))).toBe(true);
    });

    it('preserves Git repository metadata, commits, branches, and uncommitted files', async () => {
      await scaffoldProject('repo-preservation', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      const originalDir = path.join(canonicalProjects, 'repo-preservation');
      const git = simpleGit(originalDir);

      // Create a second commit and a new branch
      fs.writeFileSync(path.join(originalDir, 'extra.txt'), 'extra content');
      await git.add('.');
      await git.commit('checkpoint: add extra file');
      await git.checkoutLocalBranch('feature/test-branch');

      // Create an uncommitted modified file
      fs.writeFileSync(path.join(originalDir, 'extra.txt'), 'modified extra content');

      // Move project to 'archived' group
      const result = await moveProject('repo-preservation', 'archived', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      const movedDir = result.path;
      const movedGit = simpleGit(movedDir);

      const isRepo = await movedGit.checkIsRepo();
      expect(isRepo).toBe(true);

      const status = await movedGit.status();
      expect(status.current).toBe('feature/test-branch');
      expect(status.modified).toContain('extra.txt');

      const log = await movedGit.log();
      expect(log.total).toBe(2);
      expect(log.all[0].message).toBe('checkpoint: add extra file');
    });

    it('prevents illegal move into reserved folder names', async () => {
      await scaffoldProject('app-1', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      await expect(
        moveProject('app-1', 'throwaways', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/reserved directory name/i);

      await expect(
        moveProject('app-1', '.git', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/reserved directory name/i);
    });

    it('prevents illegal move when name collision exists at destination', async () => {
      await scaffoldProject('group-x/app-dup', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });
      await scaffoldProject('group-y/app-dup', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      await expect(
        moveProject('group-x/app-dup', 'group-y', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('rejects moving non-existent project', async () => {
      await expect(
        moveProject('does-not-exist', 'hackathons', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/Cannot locate project/i);
    });

    it('rejects moving throwaway scratchpads', async () => {
      const scratchDir = path.join(throwawaysDir, 'temp-spike');
      fs.mkdirSync(scratchDir);
      fs.writeFileSync(path.join(scratchDir, 'package.json'), '{}');

      await expect(
        moveProject('temp-spike', 'hackathons', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/throwaway/i);
    });

    it('rejects moving when target group contains invalid characters', async () => {
      await scaffoldProject('valid-app', 'typescript', {
        parentDir: canonicalProjects,
        configDir,
      });

      await expect(
        moveProject('valid-app', 'bad/group/nesting', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/forbidden characters/i);
    });
  });
});
