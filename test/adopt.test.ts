import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { adoptProject } from '../src/engine/adopt.js';
import { updateConfig } from '../src/config/index.js';

describe('Project Adoption Engine (adoptProject)', () => {
  let tempDir: string;
  let projectsDir: string;
  let desktopDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-adopt-'));
    process.env.PROJ_CONFIG_DIR = tempDir;
    projectsDir = path.join(tempDir, 'projects');
    desktopDir = path.join(tempDir, 'Desktop');

    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(desktopDir, { recursive: true });

    updateConfig({
      projectsRoot: projectsDir,
      throwawaysRoot: path.join(projectsDir, 'throwaways'),
      desktopJunctionPath: path.join(desktopDir, 'Projects'),
    });
  });

  afterEach(() => {
    if (originalEnvConfigDir !== undefined) {
      process.env.PROJ_CONFIG_DIR = originalEnvConfigDir;
    } else {
      delete process.env.PROJ_CONFIG_DIR;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws an error if source folder does not exist', async () => {
    const nonExistent = path.join(desktopDir, 'ghost-folder');
    await expect(adoptProject(nonExistent)).rejects.toThrow('does not exist');
  });

  it('throws an error if source path is a file, not a directory', async () => {
    const filePath = path.join(desktopDir, 'some-file.txt');
    fs.writeFileSync(filePath, 'hello', 'utf8');
    await expect(adoptProject(filePath)).rejects.toThrow('not a directory');
  });

  it('throws an error if target project name already exists in projectsRoot', async () => {
    const sourceFolder = path.join(desktopDir, 'duplicate-app');
    fs.mkdirSync(sourceFolder);
    fs.writeFileSync(path.join(sourceFolder, 'index.js'), 'console.log(1);');

    // Pre-create destination in projectsRoot
    fs.mkdirSync(path.join(projectsDir, 'duplicate-app'));

    await expect(adoptProject(sourceFolder)).rejects.toThrow('already exists');
  });

  it('safely moves non-git folder into canonical root, initializes Git, adds AGENTS.md guardrails, and creates checkpoint commit', async () => {
    const sourceFolder = path.join(desktopDir, 'my-legacy-app');
    fs.mkdirSync(sourceFolder);
    fs.writeFileSync(path.join(sourceFolder, 'app.js'), 'console.log("hello world");', 'utf8');
    fs.writeFileSync(path.join(sourceFolder, 'package.json'), '{"name": "my-legacy-app"}', 'utf8');

    const result = await adoptProject(sourceFolder, {
      gitAuthorName: 'AdoptTester',
      gitAuthorEmail: 'tester@proj.local',
    });

    expect(result.name).toBe('my-legacy-app');
    expect(result.path).toBe(path.join(projectsDir, 'my-legacy-app'));
    expect(result.previousPath).toBe(path.resolve(sourceFolder));
    expect(result.isGit).toBe(true);
    expect(result.commitHash).toBeDefined();

    // Source folder should no longer exist at original location
    expect(fs.existsSync(sourceFolder)).toBe(false);

    // Destination files should exist
    const destPath = result.path;
    expect(fs.existsSync(path.join(destPath, 'app.js'))).toBe(true);
    expect(fs.existsSync(path.join(destPath, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(destPath, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(destPath, '.gitignore'))).toBe(true);

    // Verify git history
    const git = simpleGit(destPath);
    const log = await git.log();
    expect(log.latest?.message).toContain('Adopted project into canonical root');
  });

  it('safely moves existing Git repository, preserving commit history', async () => {
    const sourceFolder = path.join(desktopDir, 'existing-git-repo');
    fs.mkdirSync(sourceFolder);
    fs.writeFileSync(path.join(sourceFolder, 'README.md'), '# Existing Repo', 'utf8');

    const git = simpleGit(sourceFolder);
    await git.init();
    await git.addConfig('user.name', 'OriginalAuthor', false, 'local');
    await git.addConfig('user.email', 'orig@author.local', false, 'local');
    await git.add('.');
    await git.commit('Initial existing commit');

    const result = await adoptProject(sourceFolder);

    expect(result.name).toBe('existing-git-repo');
    expect(result.path).toBe(path.join(projectsDir, 'existing-git-repo'));
    expect(fs.existsSync(sourceFolder)).toBe(false);

    const destGit = simpleGit(result.path);
    const log = await destGit.log();
    expect(log.all.some((c) => c.message.includes('Initial existing commit'))).toBe(true);
    expect(fs.existsSync(path.join(result.path, 'AGENTS.md'))).toBe(true);
  });

  it('supports custom project name option during adoption', async () => {
    const sourceFolder = path.join(desktopDir, 'source-folder-name');
    fs.mkdirSync(sourceFolder);
    fs.writeFileSync(path.join(sourceFolder, 'data.txt'), 'test', 'utf8');

    const result = await adoptProject(sourceFolder, {
      name: 'renamed-adopted-proj',
    });

    expect(result.name).toBe('renamed-adopted-proj');
    expect(result.path).toBe(path.join(projectsDir, 'renamed-adopted-proj'));
    expect(fs.existsSync(result.path)).toBe(true);
  });
});
