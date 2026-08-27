import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import { deleteProject } from '../src/engine/delete.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
  execaSync: vi.fn(),
}));

describe('Project Deletion Engine (deleteProject)', () => {
  let tempRoot: string;
  let canonicalProjects: string;
  let configDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-delete-'));
    canonicalProjects = path.join(tempRoot, 'projects');
    configDir = path.join(tempRoot, '.proj');

    fs.mkdirSync(canonicalProjects, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    // Write a mock config.json
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        projectsRoot: canonicalProjects,
        throwawaysRoot: path.join(tempRoot, 'throwaways'),
        throwaways: {},
      }),
      'utf8'
    );

    vi.clearAllMocks();
    vi.mocked(execa).mockImplementation((async () => {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as unknown as ReturnType<typeof execa>;
    }) as unknown as typeof execa);
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('Project Location Discovery & Validation', () => {
    it('throws error when target string is empty or whitespace', async () => {
      await expect(deleteProject('', { configDir })).rejects.toThrow(/empty/i);
      await expect(deleteProject('   ', { configDir })).rejects.toThrow(/empty/i);
    });

    it('throws descriptive error when project does not exist', async () => {
      await expect(deleteProject('non-existent', { configDir, projectsRoot: canonicalProjects }))
        .rejects.toThrow(/Cannot locate project "non-existent"/i);
    });

    it('locates and deletes a project by name in projectsRoot', async () => {
      const projectDir = path.join(canonicalProjects, 'test-app');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'console.log("hello");');

      const result = await deleteProject('test-app', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result).toEqual({
        name: 'test-app',
        path: projectDir,
        cloudDeleted: false,
      });
      expect(fs.existsSync(projectDir)).toBe(false);
    });

    it('locates and deletes a project by absolute path', async () => {
      const projectDir = path.join(canonicalProjects, 'abs-app');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'console.log("hello");');

      const result = await deleteProject(projectDir, {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('abs-app');
      expect(result.path).toBe(projectDir);
      expect(result.cloudDeleted).toBe(false);
      expect(fs.existsSync(projectDir)).toBe(false);
    });

    it('locates and deletes a project by relative path', async () => {
      const externalDir = path.join(tempRoot, 'rel-app');
      fs.mkdirSync(externalDir);
      fs.writeFileSync(path.join(externalDir, 'index.ts'), 'console.log("hello");');

      const result = await deleteProject(externalDir, {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('rel-app');
      expect(result.path).toBe(path.resolve(externalDir));
      expect(result.cloudDeleted).toBe(false);
      expect(fs.existsSync(externalDir)).toBe(false);
    });

    it('locates and deletes a throwaway project and cleans up throwaways config registry', async () => {
      const throwawaysDir = path.join(tempRoot, 'throwaways');
      fs.mkdirSync(throwawaysDir, { recursive: true });
      const scratchDir = path.join(throwawaysDir, 'scratch-spike');
      fs.mkdirSync(scratchDir);
      fs.writeFileSync(path.join(scratchDir, 'README.md'), '# Scratch Spike');

      const configPath = path.join(configDir, 'config.json');
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cfg.throwaways = {
        'scratch-spike': {
          name: 'scratch-spike',
          path: scratchDir,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          ttlDays: 1,
          template: 'minimal',
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(cfg), 'utf8');

      const result = await deleteProject('scratch-spike', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('scratch-spike');
      expect(fs.existsSync(scratchDir)).toBe(false);

      const reloadedCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(reloadedCfg.throwaways['scratch-spike']).toBeUndefined();
    });
  });

  describe('Working Tree Dirty Status Protection', () => {
    it('throws error with modified file count when project has uncommitted changes and force is not true', async () => {
      const projectDir = path.join(canonicalProjects, 'dirty-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'committed.txt'), 'version 1');
      await git.add('.');
      await git.commit('checkpoint: init');

      // Create 2 uncommitted changes (1 modified, 1 untracked)
      fs.writeFileSync(path.join(projectDir, 'committed.txt'), 'version 2');
      fs.writeFileSync(path.join(projectDir, 'untracked.txt'), 'untracked');

      await expect(
        deleteProject('dirty-app', {
          configDir,
          projectsRoot: canonicalProjects,
        })
      ).rejects.toThrow(/2 uncommitted change/i);

      // Directory must NOT be deleted
      expect(fs.existsSync(projectDir)).toBe(true);
    });

    it('successfully deletes a dirty project when force: true is specified', async () => {
      const projectDir = path.join(canonicalProjects, 'force-dirty-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'committed.txt'), 'version 1');
      await git.add('.');
      await git.commit('checkpoint: init');

      fs.writeFileSync(path.join(projectDir, 'uncommitted.txt'), 'dirty content');

      const result = await deleteProject('force-dirty-app', {
        configDir,
        projectsRoot: canonicalProjects,
        force: true,
      });

      expect(result.name).toBe('force-dirty-app');
      expect(result.path).toBe(projectDir);
      expect(fs.existsSync(projectDir)).toBe(false);
    });

    it('deletes a clean Git project without needing force flag', async () => {
      const projectDir = path.join(canonicalProjects, 'clean-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'committed.txt'), 'clean');
      await git.add('.');
      await git.commit('checkpoint: init');

      const result = await deleteProject('clean-app', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('clean-app');
      expect(fs.existsSync(projectDir)).toBe(false);
    });

    it('deletes a non-git project without needing force flag', async () => {
      const projectDir = path.join(canonicalProjects, 'plain-app');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'plain.txt'), 'plain text');

      const result = await deleteProject('plain-app', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('plain-app');
      expect(fs.existsSync(projectDir)).toBe(false);
    });
  });

  describe('Cloud GitHub Deletion (cloud: true)', () => {
    it('parses GitHub remote and invokes gh repo delete <owner>/<repo> --yes via execa', async () => {
      const projectDir = path.join(canonicalProjects, 'cloud-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Cloud App');
      await git.add('.');
      await git.commit('checkpoint: init');
      await git.addRemote('origin', 'https://github.com/my-org/cloud-app.git');

      const result = await deleteProject('cloud-app', {
        configDir,
        projectsRoot: canonicalProjects,
        cloud: true,
      });

      expect(execa).toHaveBeenCalledWith(
        'gh',
        ['repo', 'delete', 'my-org/cloud-app', '--yes'],
        expect.anything()
      );

      expect(result).toEqual({
        name: 'cloud-app',
        path: projectDir,
        cloudDeleted: true,
      });
      expect(fs.existsSync(projectDir)).toBe(false);
    });

    it('handles SSH remote URLs when parsing GitHub repository', async () => {
      const projectDir = path.join(canonicalProjects, 'ssh-cloud-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'README.md'), '# SSH App');
      await git.add('.');
      await git.commit('checkpoint: init');
      await git.addRemote('origin', 'git@github.com:ssh-user/ssh-cloud-app.git');

      const result = await deleteProject('ssh-cloud-app', {
        configDir,
        projectsRoot: canonicalProjects,
        cloud: true,
      });

      expect(execa).toHaveBeenCalledWith(
        'gh',
        ['repo', 'delete', 'ssh-user/ssh-cloud-app', '--yes'],
        expect.anything()
      );
      expect(result.cloudDeleted).toBe(true);
      expect(fs.existsSync(projectDir)).toBe(false);
    });

    it('throws descriptive error if cloud: true is set but project has no GitHub remote', async () => {
      const projectDir = path.join(canonicalProjects, 'no-remote-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'README.md'), '# No Remote');
      await git.add('.');
      await git.commit('checkpoint: init');

      await expect(
        deleteProject('no-remote-app', {
          configDir,
          projectsRoot: canonicalProjects,
          cloud: true,
        })
      ).rejects.toThrow(/GitHub remote/i);

      expect(execa).not.toHaveBeenCalled();
      expect(fs.existsSync(projectDir)).toBe(true);
    });

    it('throws descriptive error if cloud: true is set on a non-Git directory', async () => {
      const projectDir = path.join(canonicalProjects, 'non-git-cloud');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'file.txt'), 'hello');

      await expect(
        deleteProject('non-git-cloud', {
          configDir,
          projectsRoot: canonicalProjects,
          cloud: true,
        })
      ).rejects.toThrow(/Git repository/i);

      expect(execa).not.toHaveBeenCalled();
      expect(fs.existsSync(projectDir)).toBe(true);
    });
  });

  describe('OAuth Scope Guidance & Error Handling', () => {
    it('surfaces actionable guidance (gh auth refresh -s delete_repo) when delete_repo scope is missing', async () => {
      vi.mocked(execa).mockRejectedValueOnce(
        new Error('GraphQL: Resource protected by organization SAML enforcement or missing delete_repo scope (HTTP 403)')
      );

      const projectDir = path.join(canonicalProjects, 'scope-missing-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Scope Missing');
      await git.add('.');
      await git.commit('checkpoint: init');
      await git.addRemote('origin', 'https://github.com/my-org/scope-missing-app.git');

      await expect(
        deleteProject('scope-missing-app', {
          configDir,
          projectsRoot: canonicalProjects,
          cloud: true,
        })
      ).rejects.toThrow(/gh auth refresh -s delete_repo/i);

      expect(fs.existsSync(projectDir)).toBe(true);
    });

    it('rethrows generic gh error and protects local files if remote delete fails', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('Network connection timeout'));

      const projectDir = path.join(canonicalProjects, 'timeout-app');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Timeout App');
      await git.add('.');
      await git.commit('checkpoint: init');
      await git.addRemote('origin', 'https://github.com/my-org/timeout-app.git');

      await expect(
        deleteProject('timeout-app', {
          configDir,
          projectsRoot: canonicalProjects,
          cloud: true,
        })
      ).rejects.toThrow(/Failed to delete remote GitHub repository: Network connection timeout/i);

      expect(fs.existsSync(projectDir)).toBe(true);
    });
  });

  describe('Group Project Deletion & Empty Group Auto-Pruning', () => {
    it('deletes project by group/name syntax and auto-prunes empty parent group folder', async () => {
      const groupDir = path.join(canonicalProjects, 'hackathons');
      const projectDir = path.join(groupDir, 'agent-bot');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');

      const result = await deleteProject('hackathons/agent-bot', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('agent-bot');
      expect(result.path).toBe(projectDir);
      expect(result.groupPruned).toBe(true);
      expect(result.prunedGroup).toBe('hackathons');

      expect(fs.existsSync(projectDir)).toBe(false);
      expect(fs.existsSync(groupDir)).toBe(false);
    });

    it('deletes project by standalone name across groups and auto-prunes empty group folder', async () => {
      const groupDir = path.join(canonicalProjects, 'ai-tools');
      const projectDir = path.join(groupDir, 'unique-bot');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');

      const result = await deleteProject('unique-bot', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('unique-bot');
      expect(result.groupPruned).toBe(true);
      expect(result.prunedGroup).toBe('ai-tools');

      expect(fs.existsSync(projectDir)).toBe(false);
      expect(fs.existsSync(groupDir)).toBe(false);
    });

    it('does not prune group folder if other projects remain inside the group', async () => {
      const groupDir = path.join(canonicalProjects, 'multi-group');
      const proj1 = path.join(groupDir, 'proj-1');
      const proj2 = path.join(groupDir, 'proj-2');
      fs.mkdirSync(proj1, { recursive: true });
      fs.mkdirSync(proj2, { recursive: true });
      fs.writeFileSync(path.join(proj1, 'package.json'), '{}');
      fs.writeFileSync(path.join(proj2, 'package.json'), '{}');

      const result = await deleteProject('multi-group/proj-1', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('proj-1');
      expect(result.groupPruned).toBeFalsy();

      expect(fs.existsSync(proj1)).toBe(false);
      expect(fs.existsSync(proj2)).toBe(true);
      expect(fs.existsSync(groupDir)).toBe(true);
    });

    it('does not prune group folder if non-project files remain inside the group', async () => {
      const groupDir = path.join(canonicalProjects, 'notes-group');
      const proj1 = path.join(groupDir, 'proj-1');
      fs.mkdirSync(proj1, { recursive: true });
      fs.writeFileSync(path.join(proj1, 'package.json'), '{}');
      fs.writeFileSync(path.join(groupDir, 'notes.md'), '# Group Notes');

      const result = await deleteProject('notes-group/proj-1', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('proj-1');
      expect(result.groupPruned).toBeFalsy();

      expect(fs.existsSync(proj1)).toBe(false);
      expect(fs.existsSync(groupDir)).toBe(true);
      expect(fs.existsSync(path.join(groupDir, 'notes.md'))).toBe(true);
    });

    it('never prunes canonical projectsRoot when deleting a root standalone project', async () => {
      const projDir = path.join(canonicalProjects, 'standalone-app');
      fs.mkdirSync(projDir);
      fs.writeFileSync(path.join(projDir, 'package.json'), '{}');

      const result = await deleteProject('standalone-app', {
        configDir,
        projectsRoot: canonicalProjects,
      });

      expect(result.name).toBe('standalone-app');
      expect(result.groupPruned).toBeFalsy();
      expect(fs.existsSync(projDir)).toBe(false);
      expect(fs.existsSync(canonicalProjects)).toBe(true);
    });

    it('never prunes throwawaysRoot when deleting a throwaway project', async () => {
      const throwawaysDir = path.join(tempRoot, 'throwaways');
      fs.mkdirSync(throwawaysDir, { recursive: true });
      const scratchDir = path.join(throwawaysDir, 'temp-proj');
      fs.mkdirSync(scratchDir);
      fs.writeFileSync(path.join(scratchDir, 'package.json'), '{}');

      const result = await deleteProject('temp-proj', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysDir,
      });

      expect(result.name).toBe('temp-proj');
      expect(result.groupPruned).toBeFalsy();
      expect(fs.existsSync(scratchDir)).toBe(false);
      expect(fs.existsSync(throwawaysDir)).toBe(true);
    });
  });
});
