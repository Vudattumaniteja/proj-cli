import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import { publishProject } from '../src/engine/publish.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
  execaSync: vi.fn(),
}));

describe('Cloud GitHub Publishing Engine (publishProject)', () => {
  let tempRoot: string;
  let canonicalProjects: string;
  let throwawaysRoot: string;
  let configDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-publish-'));
    canonicalProjects = path.join(tempRoot, 'projects');
    throwawaysRoot = path.join(tempRoot, 'throwaways');
    configDir = path.join(tempRoot, '.proj');

    fs.mkdirSync(canonicalProjects, { recursive: true });
    fs.mkdirSync(throwawaysRoot, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    // Write a mock config.json
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        projectsRoot: canonicalProjects,
        throwawaysRoot: throwawaysRoot,
        throwaways: {},
      }),
      'utf8'
    );

    vi.clearAllMocks();
    vi.mocked(execa).mockImplementation((async (
      _file: string,
      args?: readonly string[],
      opts?: { cwd?: string }
    ) => {
      const repoName = args?.[2] || 'test-repo';
      const cwd = opts?.cwd;
      if (cwd) {
        try {
          const git = simpleGit(cwd);
          await git.addRemote('origin', `https://github.com/testuser/${repoName}.git`);
        } catch {
          // Ignore if remote already exists
        }
      }
      return {
        stdout: `https://github.com/testuser/${repoName}\n`,
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

  describe('Project Location Discovery', () => {
    it('locates and publishes a project located in canonical projectsRoot', async () => {
      const projectDir = path.join(canonicalProjects, 'workspace-app');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'console.log("hello");');

      const result = await publishProject('workspace-app', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      expect(result.name).toBe('workspace-app');
      expect(result.path).toBe(projectDir);
      expect(result.isPrivate).toBe(true);
      expect(result.repoUrl).toBe('https://github.com/testuser/workspace-app.git');
    });

    it('locates and publishes a project located in throwawaysRoot', async () => {
      const throwawayDir = path.join(throwawaysRoot, 'scratch-idea');
      fs.mkdirSync(throwawayDir);
      fs.writeFileSync(path.join(throwawayDir, 'README.md'), '# Scratch Idea');

      const result = await publishProject('scratch-idea', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      expect(result.name).toBe('scratch-idea');
      expect(result.path).toBe(throwawayDir);
      expect(result.isPrivate).toBe(true);
      expect(result.repoUrl).toBe('https://github.com/testuser/scratch-idea.git');
    });

    it('locates and publishes a project located inside a group folder using group/name syntax', async () => {
      const groupDir = path.join(canonicalProjects, 'hackathons');
      const projectDir = path.join(groupDir, 'agent-bot');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'console.log("bot");');

      const result = await publishProject('hackathons/agent-bot', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      expect(result.name).toBe('agent-bot');
      expect(result.path).toBe(projectDir);
      expect(result.isPrivate).toBe(true);
      expect(result.repoUrl).toBe('https://github.com/testuser/agent-bot.git');
    });

    it('locates and publishes a project located inside a group folder using unqualified name', async () => {
      const groupDir = path.join(canonicalProjects, 'web-mcp');
      const projectDir = path.join(groupDir, 'mcp-server');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');

      const result = await publishProject('mcp-server', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      expect(result.name).toBe('mcp-server');
      expect(result.path).toBe(projectDir);
      expect(result.isPrivate).toBe(true);
      expect(result.repoUrl).toBe('https://github.com/testuser/mcp-server.git');
    });

    it('throws a descriptive ambiguity error when target project name exists across multiple groups', async () => {
      const group1Dir = path.join(canonicalProjects, 'group-a', 'shared-app');
      const group2Dir = path.join(canonicalProjects, 'group-b', 'shared-app');
      fs.mkdirSync(group1Dir, { recursive: true });
      fs.mkdirSync(group2Dir, { recursive: true });
      fs.writeFileSync(path.join(group1Dir, 'index.ts'), '// a');
      fs.writeFileSync(path.join(group2Dir, 'index.ts'), '// b');

      await expect(
        publishProject('shared-app', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot,
        })
      ).rejects.toThrow(/Ambiguous project name "shared-app"/i);
    });

    it('locates and publishes a project via relative path', async () => {
      const externalDir = path.join(tempRoot, 'external-dir');
      fs.mkdirSync(externalDir);
      fs.writeFileSync(path.join(externalDir, 'app.js'), 'module.exports = {};');

      const result = await publishProject(externalDir, {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      expect(result.name).toBe('external-dir');
      expect(result.path).toBe(path.resolve(externalDir));
      expect(result.isPrivate).toBe(true);
    });

    it('throws a descriptive error when target project cannot be found anywhere', async () => {
      await expect(
        publishProject('non-existent-proj', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot,
        })
      ).rejects.toThrow(/Cannot locate project "non-existent-proj"/i);
    });

    it('throws error when target string is empty', async () => {
      await expect(publishProject('')).rejects.toThrow(/empty/i);
    });
  });

  describe('Git Repository Initialization', () => {
    it('automatically initializes Git via simple-git if .git directory does not exist', async () => {
      const projectDir = path.join(canonicalProjects, 'untracked-proj');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'main.rs'), 'fn main() {}');

      expect(fs.existsSync(path.join(projectDir, '.git'))).toBe(false);

      await publishProject('untracked-proj', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      expect(fs.existsSync(path.join(projectDir, '.git'))).toBe(true);
    });

    it('initializes Git and snapshots all files for a previously non-git directory', async () => {
      const projectDir = path.join(canonicalProjects, 'new-clean-folder');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'export const a = 1;');

      await publishProject('new-clean-folder', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      const git = simpleGit(projectDir);
      const log = await git.log();
      expect(log.total).toBe(1);
      expect(log.latest?.message).toBe('checkpoint: pre-publish snapshot');
      const status = await git.status();
      expect(status.files.length).toBe(0);
    });
  });

  describe('Working Tree Dirty Snapshot Commit', () => {
    it('stages untracked and modified files and commits "checkpoint: pre-publish snapshot" if working tree is dirty', async () => {
      const projectDir = path.join(canonicalProjects, 'dirty-proj');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      // Initial clean commit
      fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'version 1');
      await git.add('.');
      await git.commit('checkpoint: initial commit');

      // Now create a dirty working tree (untracked file + modified file)
      fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'version 2');
      fs.writeFileSync(path.join(projectDir, 'untracked.txt'), 'untracked content');

      const statusBefore = await git.status();
      expect(statusBefore.files.length).toBeGreaterThan(0);

      await publishProject('dirty-proj', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      const statusAfter = await git.status();
      expect(statusAfter.files.length).toBe(0);

      const log = await git.log();
      expect(log.latest?.message).toBe('checkpoint: pre-publish snapshot');
    });

    it('does not create a redundant checkpoint commit if working tree is clean', async () => {
      const projectDir = path.join(canonicalProjects, 'clean-proj');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Clean Repo');
      await git.add('.');
      await git.commit('checkpoint: clean commit');

      const logBefore = await git.log();
      expect(logBefore.total).toBe(1);

      await publishProject('clean-proj', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      const logAfter = await git.log();
      expect(logAfter.total).toBe(1);
      expect(logAfter.latest?.message).toBe('checkpoint: clean commit');
    });
  });

  describe('Remote Origin Protection', () => {
    it('rejects execution with descriptive error if remote origin is already configured', async () => {
      const projectDir = path.join(canonicalProjects, 'already-published');
      fs.mkdirSync(projectDir);

      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-author', false, 'local');
      await git.addConfig('user.email', 'test@test.local', false, 'local');

      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Existing');
      await git.add('.');
      await git.commit('checkpoint: init');
      await git.addRemote('origin', 'https://github.com/existing-user/already-published.git');

      await expect(
        publishProject('already-published', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot,
        })
      ).rejects.toThrow(/remote "origin" is already configured/i);

      // Verify execa was NOT called to create repo
      expect(execa).not.toHaveBeenCalled();
    });
  });

  describe('GitHub CLI Execution & Structured Output', () => {
    it('executes gh repo create <repoName> --private --source . --remote origin --push via execa', async () => {
      const projectDir = path.join(canonicalProjects, 'my-cli-tool');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');

      const result = await publishProject('my-cli-tool', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
      });

      expect(execa).toHaveBeenCalledWith(
        'gh',
        ['repo', 'create', 'my-cli-tool', '--private', '--source', '.', '--remote', 'origin', '--push'],
        { cwd: projectDir }
      );

      expect(result).toEqual({
        name: 'my-cli-tool',
        path: projectDir,
        repoUrl: 'https://github.com/testuser/my-cli-tool.git',
        isPrivate: true,
      });
    });

    it('supports custom repoName in options', async () => {
      const projectDir = path.join(canonicalProjects, 'custom-folder');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'index.js'), 'console.log()');

      const result = await publishProject('custom-folder', {
        configDir,
        projectsRoot: canonicalProjects,
        throwawaysRoot,
        repoName: 'custom-cloud-repo',
      });

      expect(execa).toHaveBeenCalledWith(
        'gh',
        ['repo', 'create', 'custom-cloud-repo', '--private', '--source', '.', '--remote', 'origin', '--push'],
        { cwd: projectDir }
      );

      expect(result.name).toBe('custom-cloud-repo');
      expect(result.isPrivate).toBe(true);
    });

    it('rethrows descriptive error if execa gh command fails', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('GraphQL: Name already exists on this account'));

      const projectDir = path.join(canonicalProjects, 'failed-app');
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, 'README.md'), 'test');

      await expect(
        publishProject('failed-app', {
          configDir,
          projectsRoot: canonicalProjects,
          throwawaysRoot,
        })
      ).rejects.toThrow(/Failed to publish project to GitHub: GraphQL: Name already exists on this account/i);
    });
  });
});
