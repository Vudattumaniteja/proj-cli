import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import {
  listProjects,
  detectTemplateType,
  getTemplateBadge,
  inspectProject,
  formatProjectsJson,
  formatProjectsTable,
  type ProjectInfo,
} from '../src/engine/discovery.js';

describe('Project Discovery Engine', () => {
  let tempRoot: string;
  let canonicalProjects: string;
  let throwawaysDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-discovery-'));
    canonicalProjects = path.join(tempRoot, 'projects');
    throwawaysDir = path.join(canonicalProjects, 'throwaways');
    fs.mkdirSync(canonicalProjects, { recursive: true });
    fs.mkdirSync(throwawaysDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('Directory scanning & basic discovery', () => {
    it('returns empty array when canonicalRoot is empty', async () => {
      const projects = await listProjects(canonicalProjects);
      expect(projects).toEqual([]);
    });

    it('returns empty array when canonicalRoot does not exist', async () => {
      const nonExistent = path.join(tempRoot, 'does-not-exist');
      const projects = await listProjects(nonExistent);
      expect(projects).toEqual([]);
    });

    it('discovers standard project folders and extracts folder name, path, and isThrowaway = false', async () => {
      const proj1 = path.join(canonicalProjects, 'web-app');
      const proj2 = path.join(canonicalProjects, 'api-service');
      fs.mkdirSync(proj1);
      fs.mkdirSync(proj2);

      const projects = await listProjects(canonicalProjects);
      expect(projects).toHaveLength(2);

      const names = projects.map((p) => p.name).sort();
      expect(names).toEqual(['api-service', 'web-app']);

      const webApp = projects.find((p) => p.name === 'web-app')!;
      expect(webApp.path).toBe(path.resolve(proj1));
      expect(webApp.isThrowaway).toBe(false);
      expect(webApp.isGit).toBe(false);
    });

    it('discovers scratchpads inside throwaways directory with isThrowaway = true without listing throwaways directory as a project', async () => {
      const proj1 = path.join(canonicalProjects, 'my-lib');
      const scratch1 = path.join(throwawaysDir, 'proto-poc');
      fs.mkdirSync(proj1);
      fs.mkdirSync(scratch1);

      const projects = await listProjects(canonicalProjects);
      expect(projects).toHaveLength(2);

      const libProj = projects.find((p) => p.name === 'my-lib')!;
      expect(libProj.isThrowaway).toBe(false);

      const scratchProj = projects.find((p) => p.name === 'proto-poc')!;
      expect(scratchProj.isThrowaway).toBe(true);
      expect(scratchProj.path).toBe(path.resolve(scratch1));
    });

    it('ignores non-directory files and hidden directories in projects root', async () => {
      const regularProj = path.join(canonicalProjects, 'real-project');
      fs.mkdirSync(regularProj);

      fs.writeFileSync(path.join(canonicalProjects, 'notes.txt'), 'some notes');
      fs.mkdirSync(path.join(canonicalProjects, '.hidden-folder'));

      const projects = await listProjects(canonicalProjects);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('real-project');
    });

    it('handles custom throwawaysRoot path passed in options', async () => {
      const customThrowaways = path.join(tempRoot, 'custom-throwaways');
      fs.mkdirSync(customThrowaways, { recursive: true });
      fs.mkdirSync(path.join(customThrowaways, 'temp-spike'));

      const projects = await listProjects(canonicalProjects, {
        throwawaysRoot: customThrowaways,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('temp-spike');
      expect(projects[0].isThrowaway).toBe(true);
    });

    it('supports includeThrowaways = false to scan canonical root only', async () => {
      const proj1 = path.join(canonicalProjects, 'core-app');
      const scratch1 = path.join(throwawaysDir, 'proto');
      fs.mkdirSync(proj1);
      fs.mkdirSync(scratch1);

      const projects = await listProjects(canonicalProjects, {
        includeThrowaways: false,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('core-app');
    });
  });

  describe('Template Detection', () => {
    it('detects typescript template from tsconfig.json or ts dependencies', () => {
      const projDir = path.join(canonicalProjects, 'ts-app');
      fs.mkdirSync(projDir);
      fs.writeFileSync(path.join(projDir, 'tsconfig.json'), '{}');

      expect(detectTemplateType(projDir)).toBe('typescript');
      expect(getTemplateBadge('typescript')).toBe('[typescript]');
    });

    it('detects python template from pyproject.toml or requirements.txt', () => {
      const projDir = path.join(canonicalProjects, 'py-app');
      fs.mkdirSync(projDir);
      fs.writeFileSync(path.join(projDir, 'requirements.txt'), 'fastapi\n');

      expect(detectTemplateType(projDir)).toBe('python');
      expect(getTemplateBadge('python')).toBe('[python]');
    });

    it('detects rust template from Cargo.toml', () => {
      const projDir = path.join(canonicalProjects, 'rust-app');
      fs.mkdirSync(projDir);
      fs.writeFileSync(path.join(projDir, 'Cargo.toml'), '[package]\nname = "rust-app"');

      expect(detectTemplateType(projDir)).toBe('rust');
      expect(getTemplateBadge('rust')).toBe('[rust]');
    });

    it('detects go template from go.mod', () => {
      const projDir = path.join(canonicalProjects, 'go-app');
      fs.mkdirSync(projDir);
      fs.writeFileSync(path.join(projDir, 'go.mod'), 'module go-app\ngo 1.22');

      expect(detectTemplateType(projDir)).toBe('go');
      expect(getTemplateBadge('go')).toBe('[go]');
    });

    it('detects web template from vite.config or index.html', () => {
      const projDir = path.join(canonicalProjects, 'web-starter');
      fs.mkdirSync(projDir);
      fs.writeFileSync(path.join(projDir, 'index.html'), '<!DOCTYPE html>');

      expect(detectTemplateType(projDir)).toBe('web');
      expect(getTemplateBadge('web')).toBe('[web]');
    });

    it('detects node template from package.json without typescript', () => {
      const projDir = path.join(canonicalProjects, 'node-app');
      fs.mkdirSync(projDir);
      fs.writeFileSync(
        path.join(projDir, 'package.json'),
        JSON.stringify({ name: 'node-app', dependencies: { express: '^4.18.0' } })
      );

      expect(detectTemplateType(projDir)).toBe('node');
      expect(getTemplateBadge('node')).toBe('[node]');
    });

    it('detects minimal template when only AGENTS.md or .gitignore is present', () => {
      const projDir = path.join(canonicalProjects, 'minimal-app');
      fs.mkdirSync(projDir);
      fs.writeFileSync(path.join(projDir, 'AGENTS.md'), '# AGENTS.md');
      fs.writeFileSync(path.join(projDir, '.gitignore'), 'dist/');

      expect(detectTemplateType(projDir)).toBe('minimal');
      expect(getTemplateBadge('minimal')).toBe('[minimal]');
    });

    it('returns null and [unknown] badge for empty or unrecognized folders', () => {
      const projDir = path.join(canonicalProjects, 'empty-app');
      fs.mkdirSync(projDir);

      expect(detectTemplateType(projDir)).toBe(null);
      expect(getTemplateBadge(null)).toBe('[unknown]');
    });
  });

  describe('Git Repository Inspection', () => {
    it('accurately extracts active Git branch, clean status, and template badge for clean Git repo', async () => {
      const repoDir = path.join(canonicalProjects, 'git-clean-app');
      fs.mkdirSync(repoDir);
      fs.writeFileSync(path.join(repoDir, 'tsconfig.json'), '{}');
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Clean App');

      const git = simpleGit(repoDir);
      await git.init();
      await git.addConfig('user.name', 'Tester');
      await git.addConfig('user.email', 'tester@example.com');
      await git.checkoutLocalBranch('main');
      await git.add('.');
      await git.commit('initial commit');

      const info = await inspectProject(repoDir);

      expect(info.name).toBe('git-clean-app');
      expect(info.isGit).toBe(true);
      expect(info.branch).toBe('main');
      expect(info.dirtyCount).toBe(0);
      expect(info.isDirty).toBe(false);
      expect(info.templateType).toBe('typescript');
      expect(info.templateBadge).toBe('[typescript]');
      expect(info.lastModified instanceof Date).toBe(true);
    });

    it('extracts dirty status and uncommitted change count for repository with modifications & untracked files', async () => {
      const repoDir = path.join(canonicalProjects, 'git-dirty-app');
      fs.mkdirSync(repoDir);
      fs.writeFileSync(path.join(repoDir, 'requirements.txt'), 'flask');

      const git = simpleGit(repoDir);
      await git.init();
      await git.addConfig('user.name', 'Tester');
      await git.addConfig('user.email', 'tester@example.com');
      await git.checkoutLocalBranch('feature/auth');
      await git.add('.');
      await git.commit('initial commit');

      // Add 1 untracked file and modify 1 tracked file
      fs.writeFileSync(path.join(repoDir, 'requirements.txt'), 'flask\npytest');
      fs.writeFileSync(path.join(repoDir, 'untracked.py'), 'print(1)');

      const info = await inspectProject(repoDir);

      expect(info.name).toBe('git-dirty-app');
      expect(info.isGit).toBe(true);
      expect(info.branch).toBe('feature/auth');
      expect(info.dirtyCount).toBe(2);
      expect(info.isDirty).toBe(true);
      expect(info.templateType).toBe('python');
    });

    it('gracefully handles non-Git directories without crashing', async () => {
      const nonGitDir = path.join(canonicalProjects, 'non-git-folder');
      fs.mkdirSync(nonGitDir);
      fs.writeFileSync(path.join(nonGitDir, 'Cargo.toml'), '[package]');

      const info = await inspectProject(nonGitDir);

      expect(info.isGit).toBe(false);
      expect(info.branch).toBe(null);
      expect(info.dirtyCount).toBe(0);
      expect(info.isDirty).toBe(false);
      expect(info.templateType).toBe('rust');
    });

    it('handles empty folders and invalid directories gracefully', async () => {
      const emptyDir = path.join(canonicalProjects, 'empty-dir');
      fs.mkdirSync(emptyDir);

      const info = await inspectProject(emptyDir);

      expect(info.isGit).toBe(false);
      expect(info.branch).toBe(null);
      expect(info.dirtyCount).toBe(0);
      expect(info.templateBadge).toBe('[unknown]');
    });
  });

  describe('Output Formatting Functions', () => {
    const sampleProjects: ProjectInfo[] = [
      {
        name: 'web-portal',
        path: 'C:\\projects\\web-portal',
        isGit: true,
        branch: 'main',
        dirtyCount: 0,
        isDirty: false,
        templateType: 'typescript',
        templateBadge: '[typescript]',
        lastModified: new Date('2026-08-19T10:30:00Z'),
        isThrowaway: false,
        hasRemote: false,
      },
      {
        name: 'temp-spike',
        path: 'C:\\projects\\throwaways\\temp-spike',
        isGit: true,
        branch: 'feat/poc',
        dirtyCount: 3,
        isDirty: true,
        templateType: 'python',
        templateBadge: '[python]',
        lastModified: new Date('2026-08-19T11:00:00Z'),
        isThrowaway: true,
        hasRemote: false,
      },
      {
        name: 'plain-folder',
        path: 'C:\\projects\\plain-folder',
        isGit: false,
        branch: null,
        dirtyCount: 0,
        isDirty: false,
        templateType: null,
        templateBadge: '[unknown]',
        lastModified: new Date('2026-08-19T09:00:00Z'),
        isThrowaway: false,
        hasRemote: false,
      },
    ];

    it('formatProjectsJson() outputs valid JSON array representing project list', () => {
      const jsonStr = formatProjectsJson(sampleProjects);
      const parsed = JSON.parse(jsonStr);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].name).toBe('web-portal');
      expect(parsed[0].templateBadge).toBe('[typescript]');
      expect(parsed[1].name).toBe('temp-spike');
      expect(parsed[1].dirtyCount).toBe(3);
      expect(parsed[1].isThrowaway).toBe(true);
    });

    it('formatProjectsTable() outputs formatted table with headers and aligned columns', () => {
      const tableStr = formatProjectsTable(sampleProjects);

      expect(tableStr).toContain('NAME');
      expect(tableStr).toContain('TEMPLATE');
      expect(tableStr).toContain('BRANCH');
      expect(tableStr).toContain('STATUS');
      expect(tableStr).toContain('LAST MODIFIED');
      expect(tableStr).toContain('PATH');

      expect(tableStr).toContain('web-portal');
      expect(tableStr).toContain('[typescript]');
      expect(tableStr).toContain('main');
      expect(tableStr).toContain('clean');

      expect(tableStr).toContain('temp-spike (throwaway)');
      expect(tableStr).toContain('[python]');
      expect(tableStr).toContain('feat/poc');
      expect(tableStr).toContain('3 dirty');

      expect(tableStr).toContain('plain-folder');
      expect(tableStr).toContain('[unknown]');
      expect(tableStr).toContain('non-git');
    });

    it('formatProjectsTable() returns friendly message when projects array is empty', () => {
      const emptyTable = formatProjectsTable([]);
      expect(emptyTable).toBe('No projects found.');
    });
  });
});
