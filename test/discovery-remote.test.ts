import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import {
  inspectProject,
  listProjects,
  parseGitHubRemote,
} from '../src/engine/discovery.js';

describe('Remote Origin Detection & Git Metadata', () => {
  let tempRoot: string;
  let canonicalProjects: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-remote-'));
    canonicalProjects = path.join(tempRoot, 'projects');
    fs.mkdirSync(canonicalProjects, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('parseGitHubRemote()', () => {
    it('correctly parses HTTPS remote URLs with .git', () => {
      const result = parseGitHubRemote('https://github.com/owner/repo.git');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
      });
    });

    it('correctly parses HTTPS remote URLs without .git', () => {
      const result = parseGitHubRemote('https://github.com/owner/repo');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
      });
    });

    it('correctly parses SSH remote URLs with .git', () => {
      const result = parseGitHubRemote('git@github.com:owner/repo.git');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
      });
    });

    it('correctly parses SSH remote URLs without .git', () => {
      const result = parseGitHubRemote('git@github.com:owner/repo');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
      });
    });

    it('correctly parses ssh:// protocol URLs', () => {
      const result = parseGitHubRemote('ssh://git@github.com/owner/repo.git');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
      });
    });

    it('correctly handles URLs with credentials or authentication tokens', () => {
      const result = parseGitHubRemote('https://token@github.com/owner/repo.git');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        webUrl: 'https://github.com/owner/repo',
      });
    });

    it('returns undefined for non-GitHub remotes', () => {
      expect(parseGitHubRemote('https://gitlab.com/owner/repo.git')).toBeUndefined();
      expect(parseGitHubRemote('git@gitlab.com:owner/repo.git')).toBeUndefined();
      expect(parseGitHubRemote('https://bitbucket.org/owner/repo.git')).toBeUndefined();
    });

    it('returns undefined for invalid or empty input', () => {
      expect(parseGitHubRemote('')).toBeUndefined();
      expect(parseGitHubRemote('not-a-url')).toBeUndefined();
    });
  });

  describe('inspectProject() Remote Origin Detection', () => {
    it('detects HTTPS origin remote and parses githubRepo metadata', async () => {
      const repoDir = path.join(canonicalProjects, 'https-repo');
      fs.mkdirSync(repoDir);

      const git = simpleGit(repoDir);
      await git.init();
      await git.addRemote('origin', 'https://github.com/Vudattumaniteja/proj-cli.git');

      const info = await inspectProject(repoDir);

      expect(info.isGit).toBe(true);
      expect(info.hasRemote).toBe(true);
      expect(info.remoteUrl).toBe('https://github.com/Vudattumaniteja/proj-cli.git');
      expect(info.githubRepo).toEqual({
        owner: 'Vudattumaniteja',
        repo: 'proj-cli',
        webUrl: 'https://github.com/Vudattumaniteja/proj-cli',
      });
    });

    it('detects SSH origin remote and parses githubRepo metadata', async () => {
      const repoDir = path.join(canonicalProjects, 'ssh-repo');
      fs.mkdirSync(repoDir);

      const git = simpleGit(repoDir);
      await git.init();
      await git.addRemote('origin', 'git@github.com:Vudattumaniteja/proj-cli.git');

      const info = await inspectProject(repoDir);

      expect(info.isGit).toBe(true);
      expect(info.hasRemote).toBe(true);
      expect(info.remoteUrl).toBe('git@github.com:Vudattumaniteja/proj-cli.git');
      expect(info.githubRepo).toEqual({
        owner: 'Vudattumaniteja',
        repo: 'proj-cli',
        webUrl: 'https://github.com/Vudattumaniteja/proj-cli',
      });
    });

    it('detects non-GitHub remote with hasRemote = true and githubRepo = undefined', async () => {
      const repoDir = path.join(canonicalProjects, 'gitlab-repo');
      fs.mkdirSync(repoDir);

      const git = simpleGit(repoDir);
      await git.init();
      await git.addRemote('origin', 'https://gitlab.com/group/gitlab-project.git');

      const info = await inspectProject(repoDir);

      expect(info.isGit).toBe(true);
      expect(info.hasRemote).toBe(true);
      expect(info.remoteUrl).toBe('https://gitlab.com/group/gitlab-project.git');
      expect(info.githubRepo).toBeUndefined();
    });

    it('returns hasRemote = false for repository without remotes', async () => {
      const repoDir = path.join(canonicalProjects, 'local-only-repo');
      fs.mkdirSync(repoDir);

      const git = simpleGit(repoDir);
      await git.init();

      const info = await inspectProject(repoDir);

      expect(info.isGit).toBe(true);
      expect(info.hasRemote).toBe(false);
      expect(info.remoteUrl).toBeUndefined();
      expect(info.githubRepo).toBeUndefined();
    });

    it('returns hasRemote = false for non-git directory', async () => {
      const nonGitDir = path.join(canonicalProjects, 'not-a-repo');
      fs.mkdirSync(nonGitDir);

      const info = await inspectProject(nonGitDir);

      expect(info.isGit).toBe(false);
      expect(info.hasRemote).toBe(false);
      expect(info.remoteUrl).toBeUndefined();
      expect(info.githubRepo).toBeUndefined();
    });

    it('gracefully handles corrupt .git configs without crashing or throwing', async () => {
      const corruptDir = path.join(canonicalProjects, 'corrupt-repo');
      fs.mkdirSync(corruptDir);
      const gitDir = path.join(corruptDir, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'config'), 'corrupted invalid git config content [');

      const info = await inspectProject(corruptDir);

      expect(info.hasRemote).toBe(false);
      expect(info.remoteUrl).toBeUndefined();
      expect(info.githubRepo).toBeUndefined();
    });
  });

  describe('listProjects() Remote Origin Resilience', () => {
    it('discovers projects including remote origin information and handles corrupt repos gracefully', async () => {
      // 1. Normal GitHub repo
      const ghDir = path.join(canonicalProjects, 'gh-app');
      fs.mkdirSync(ghDir);
      const git = simpleGit(ghDir);
      await git.init();
      await git.addRemote('origin', 'https://github.com/owner/gh-app.git');

      // 2. Corrupted repo
      const corruptDir = path.join(canonicalProjects, 'broken-app');
      fs.mkdirSync(corruptDir);
      fs.mkdirSync(path.join(corruptDir, '.git'));
      fs.writeFileSync(path.join(corruptDir, '.git', 'config'), 'corrupt config data %%');

      // 3. Plain non-git project
      const plainDir = path.join(canonicalProjects, 'plain-app');
      fs.mkdirSync(plainDir);

      const projects = await listProjects(canonicalProjects, { includeThrowaways: false });

      expect(projects).toHaveLength(3);

      const ghProj = projects.find((p) => p.name === 'gh-app')!;
      expect(ghProj.hasRemote).toBe(true);
      expect(ghProj.remoteUrl).toBe('https://github.com/owner/gh-app.git');
      expect(ghProj.githubRepo).toEqual({
        owner: 'owner',
        repo: 'gh-app',
        webUrl: 'https://github.com/owner/gh-app',
      });

      const corruptProj = projects.find((p) => p.name === 'broken-app')!;
      expect(corruptProj.hasRemote).toBe(false);

      const plainProj = projects.find((p) => p.name === 'plain-app')!;
      expect(plainProj.hasRemote).toBe(false);
      expect(plainProj.isGit).toBe(false);
    });
  });
});
