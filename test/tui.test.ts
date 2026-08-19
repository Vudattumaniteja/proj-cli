import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import {
  launchInteractiveDashboard,
  interactiveNewProject,
  interactiveThrowaway,
  interactiveRollback,
  interactiveViewProjects,
  interactiveRules,
  interactiveDoctor,
  interactiveAdopt,
} from '../src/tui/index.js';
import { updateConfig, ensureConfigDirs } from '../src/config/index.js';
import { readIpcToken } from '../src/ipc/index.js';
import { createCheckpoint } from '../src/engine/gitSafety.js';
import { scaffoldProject } from '../src/engine/scaffold.js';

vi.mock('@clack/prompts', () => {
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn((val) => val === '__CANCEL__'),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    })),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
    },
  };
});

describe('Clack TUI Dashboard & Interactive Wizards', () => {
  let tempDir: string;
  let projectsDir: string;
  let throwawaysDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-tui-'));
    process.env.PROJ_CONFIG_DIR = tempDir;
    projectsDir = path.join(tempDir, 'projects');
    throwawaysDir = path.join(projectsDir, 'throwaways');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(throwawaysDir, { recursive: true });

    updateConfig({
      projectsRoot: projectsDir,
      throwawaysRoot: throwawaysDir,
      desktopJunctionPath: path.join(tempDir, 'Desktop', 'Projects'),
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

  it('launches main interactive dashboard and exits cleanly when exit is selected', async () => {
    vi.mocked(p.select).mockResolvedValueOnce('exit');

    await launchInteractiveDashboard({ configDir: tempDir });

    expect(p.intro).toHaveBeenCalled();
    expect(p.outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('runs interactiveNewProject wizard to create project and emit code IPC token', async () => {
    // 1. Text prompt: project name
    vi.mocked(p.text).mockResolvedValueOnce('tui-created-app');
    // 2. Select prompt: template
    vi.mocked(p.select).mockResolvedValueOnce('typescript');
    // 3. Select prompt: next step
    vi.mocked(p.select).mockResolvedValueOnce('code');

    await interactiveNewProject({ configDir: tempDir });

    const createdPath = path.join(projectsDir, 'tui-created-app');
    expect(fs.existsSync(createdPath)).toBe(true);
    expect(fs.existsSync(path.join(createdPath, 'package.json'))).toBe(true);
    expect(p.note).toHaveBeenCalled();

    const token = readIpcToken({ configDir: tempDir });
    expect(token?.action).toBe('code');
    expect(token?.targetPath).toBe(createdPath);
  });

  it('runs interactiveThrowaway wizard and creates scratchpad with TTL', async () => {
    // 1. Name
    vi.mocked(p.text).mockResolvedValueOnce('tui-scratch-app');
    // 2. TTL
    vi.mocked(p.select).mockResolvedValueOnce(7);
    // 3. Template
    vi.mocked(p.select).mockResolvedValueOnce('web');
    // 4. Next action
    vi.mocked(p.select).mockResolvedValueOnce('jump');

    await interactiveThrowaway({ configDir: tempDir });

    const scratchPath = path.join(throwawaysDir, 'tui-scratch-app');
    expect(fs.existsSync(scratchPath)).toBe(true);
    expect(fs.existsSync(path.join(scratchPath, 'index.html'))).toBe(true);

    const token = readIpcToken({ configDir: tempDir });
    expect(token?.action).toBe('cd');
    expect(token?.targetPath).toBe(scratchPath);
  });

  it('runs interactiveViewProjects to list projects and jump to selected repository', async () => {
    // Scaffold a project first
    await scaffoldProject('browseable-app', 'minimal', {
      configDir: tempDir,
      parentDir: projectsDir,
    });

    // 1. Select project: 'browseable-app'
    vi.mocked(p.select).mockResolvedValueOnce('browseable-app');
    // 2. Select context action: 'jump'
    vi.mocked(p.select).mockResolvedValueOnce('jump');

    const result = await interactiveViewProjects({ configDir: tempDir });
    expect(result).toBe('exit');

    const token = readIpcToken({ configDir: tempDir });
    expect(token?.action).toBe('cd');
    expect(token?.targetPath).toBe(path.join(projectsDir, 'browseable-app'));
  });

  it('runs interactiveViewProjects context action to open in VS Code', async () => {
    await scaffoldProject('code-open-app', 'python', {
      configDir: tempDir,
      parentDir: projectsDir,
    });

    // 1. Select project
    vi.mocked(p.select).mockResolvedValueOnce('code-open-app');
    // 2. Action: code
    vi.mocked(p.select).mockResolvedValueOnce('code');

    const result = await interactiveViewProjects({ configDir: tempDir });
    expect(result).toBe('exit');

    const token = readIpcToken({ configDir: tempDir });
    expect(token?.action).toBe('code');
    expect(token?.targetPath).toBe(path.join(projectsDir, 'code-open-app'));
  });

  it('runs interactiveRollback selector to rollback git repository to chosen checkpoint', async () => {
    const projResult = await scaffoldProject('rollback-test-app', 'minimal', {
      configDir: tempDir,
      parentDir: projectsDir,
    });
    const projPath = projResult.path;

    // Create a checkpoint
    fs.writeFileSync(path.join(projPath, 'file1.txt'), 'v1');
    const cp1 = await createCheckpoint(projPath, 'first milestone');

    fs.writeFileSync(path.join(projPath, 'file2.txt'), 'v2');
    await createCheckpoint(projPath, 'second milestone');

    // Select checkpoint cp1.hash
    vi.mocked(p.select).mockResolvedValueOnce(cp1.hash);

    await interactiveRollback(projPath, { configDir: tempDir });

    expect(p.note).toHaveBeenCalled();
    expect(fs.existsSync(path.join(projPath, 'file2.txt'))).toBe(false);
  });

  it('runs interactiveRules wizard to view and edit AGENTS.md', async () => {
    ensureConfigDirs({ configDir: tempDir });

    // 1. View rules
    vi.mocked(p.select).mockResolvedValueOnce('view');
    await interactiveRules({ configDir: tempDir });
    expect(p.note).toHaveBeenCalled();

    // 2. Edit rules
    vi.mocked(p.select).mockResolvedValueOnce('edit');
    await interactiveRules({ configDir: tempDir });
    const token = readIpcToken({ configDir: tempDir });
    expect(token?.action).toBe('code');
    expect(token?.targetPath).toContain('AGENTS.md');
  });

  it('runs interactiveDoctor wizard to perform checks and self-healing', async () => {
    // 1. Check mode
    vi.mocked(p.select).mockResolvedValueOnce('check');
    await interactiveDoctor({ configDir: tempDir });
    expect(p.note).toHaveBeenCalled();

    // 2. Fix mode
    vi.mocked(p.select).mockResolvedValueOnce('fix');
    await interactiveDoctor({ configDir: tempDir });
    expect(p.note).toHaveBeenCalled();
  });

  it('runs interactiveAdopt wizard to adopt legacy folder', async () => {
    const legacyFolder = path.join(tempDir, 'legacy-source');
    fs.mkdirSync(legacyFolder);
    fs.writeFileSync(path.join(legacyFolder, 'main.js'), 'console.log(1);');

    // 1. Text: folder path
    vi.mocked(p.text).mockResolvedValueOnce(legacyFolder);
    // 2. Next step: done
    vi.mocked(p.select).mockResolvedValueOnce('done');

    await interactiveAdopt({ configDir: tempDir });

    expect(fs.existsSync(path.join(projectsDir, 'legacy-source', 'main.js'))).toBe(true);
    expect(fs.existsSync(legacyFolder)).toBe(false);
  });
});
