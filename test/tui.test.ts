import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import {
  launchInteractiveDashboard,
  handleExpiredThrowaways,
  interactiveNewProject,
  interactiveThrowaway,
  interactiveRollback,
  interactiveViewProjects,
  interactiveRules,
  interactiveDoctor,
  interactiveAdopt,
} from '../src/tui/index.js';
import { getConfig, updateConfig, ensureConfigDirs } from '../src/config/index.js';
import { readIpcToken } from '../src/ipc/index.js';
import { createCheckpoint } from '../src/engine/gitSafety.js';
import { scaffoldProject } from '../src/engine/scaffold.js';
import { createThrowaway } from '../src/engine/throwaway.js';

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

  it('runs interactiveViewProjects and formats throwaways with badges including [throwaway: EXPIRED]', async () => {
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    await createThrowaway('expired-tui-app', 1, 'minimal', {
      configDir: tempDir,
      throwawaysRoot: throwawaysDir,
      now: pastDate,
    });
    await createThrowaway('active-tui-app', 1, 'minimal', {
      configDir: tempDir,
      throwawaysRoot: throwawaysDir,
      now: futureDate,
    });

    // Cancel / back out from selection
    vi.mocked(p.select).mockResolvedValueOnce('__back__');

    const result = await interactiveViewProjects({ configDir: tempDir });
    expect(result).toBe('back');

    const selectCalls = vi.mocked(p.select).mock.calls;
    const projectPickerCall = selectCalls[0][0] as any;
    const options = projectPickerCall.options;

    const expiredOption = options.find((opt: any) => opt.value === 'expired-tui-app');
    expect(expiredOption).toBeDefined();
    expect(expiredOption.label).toContain('[throwaway: EXPIRED]');

    const activeOption = options.find((opt: any) => opt.value === 'active-tui-app');
    expect(activeOption).toBeDefined();
    expect(activeOption.label).toContain('[throwaway]');
    expect(activeOption.label).not.toContain('[throwaway: EXPIRED]');
  });

  it('runs interactiveViewProjects context action to graduate a throwaway project', async () => {
    await createThrowaway('grad-tui-app', 3, 'minimal', {
      configDir: tempDir,
      throwawaysRoot: throwawaysDir,
    });

    const scratchPath = path.join(throwawaysDir, 'grad-tui-app');
    const permPath = path.join(projectsDir, 'grad-tui-app');
    expect(fs.existsSync(scratchPath)).toBe(true);

    // 1. Select project: 'grad-tui-app'
    vi.mocked(p.select).mockResolvedValueOnce('grad-tui-app');
    // 2. Select action: 'graduate'
    vi.mocked(p.select).mockResolvedValueOnce('graduate');
    // 3. Next iteration (returns to project list): cancel / back
    vi.mocked(p.select).mockResolvedValueOnce('__back__');

    const result = await interactiveViewProjects({ configDir: tempDir });
    expect(result).toBe('back');

    expect(fs.existsSync(scratchPath)).toBe(false);
    expect(fs.existsSync(permPath)).toBe(true);
    expect(fs.existsSync(path.join(permPath, '.git'))).toBe(true);
  });

  it('runs interactiveViewProjects context action to extend throwaway TTL', async () => {
    const created = await createThrowaway('ext-tui-app', 2, 'minimal', {
      configDir: tempDir,
      throwawaysRoot: throwawaysDir,
    });

    // 1. Select project
    vi.mocked(p.select).mockResolvedValueOnce('ext-tui-app');
    // 2. Select action: 'extend'
    vi.mocked(p.select).mockResolvedValueOnce('extend');
    // 3. Return to list: back
    vi.mocked(p.select).mockResolvedValueOnce('__back__');

    await interactiveViewProjects({ configDir: tempDir });

    const cfg = getConfig({ configDir: tempDir });
    const record = cfg.throwaways?.['ext-tui-app'];
    expect(record).toBeDefined();
    expect(record?.ttlDays).toBe(5); // 2 + 3
    expect(new Date(record!.expiresAt).getTime()).toBeGreaterThan(
      new Date(created.expiresAt).getTime()
    );
  });

  it('runs interactiveViewProjects context action to delete throwaway', async () => {
    await scaffoldProject('permanent-app', 'minimal', {
      configDir: tempDir,
      parentDir: projectsDir,
    });
    await createThrowaway('del-tui-app', 2, 'minimal', {
      configDir: tempDir,
      throwawaysRoot: throwawaysDir,
    });

    const scratchPath = path.join(throwawaysDir, 'del-tui-app');
    expect(fs.existsSync(scratchPath)).toBe(true);

    // 1. Select project
    vi.mocked(p.select).mockResolvedValueOnce('del-tui-app');
    // 2. Select action: 'delete'
    vi.mocked(p.select).mockResolvedValueOnce('delete');
    // 3. Return to list: back
    vi.mocked(p.select).mockResolvedValueOnce('__back__');

    await interactiveViewProjects({ configDir: tempDir });

    expect(fs.existsSync(scratchPath)).toBe(false);
    const cfg = getConfig({ configDir: tempDir });
    expect(cfg.throwaways?.['del-tui-app']).toBeUndefined();
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

  describe('Startup Expired Throwaways Evaluation & Interactive Handler', () => {
    it('handles expired throwaways on dashboard launch by deleting expired scratchpad', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createThrowaway('expired-del', 1, 'minimal', {
        configDir: tempDir,
        throwawaysRoot: throwawaysDir,
        now: pastDate,
      });

      const scratchPath = path.join(throwawaysDir, 'expired-del');
      expect(fs.existsSync(scratchPath)).toBe(true);

      // 1. Expired handler select action: 'delete'
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 2. Main menu select action: 'exit'
      vi.mocked(p.select).mockResolvedValueOnce('exit');

      await launchInteractiveDashboard({ configDir: tempDir });

      expect(fs.existsSync(scratchPath)).toBe(false);
      const cfg = getConfig({ configDir: tempDir });
      expect(cfg.throwaways?.['expired-del']).toBeUndefined();
    });

    it('handles expired throwaways on dashboard launch by extending expiration (+3d)', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const created = await createThrowaway('expired-ext', 1, 'minimal', {
        configDir: tempDir,
        throwawaysRoot: throwawaysDir,
        now: pastDate,
      });

      const initialExpiresAt = created.expiresAt;

      // 1. Expired handler select action: 'extend'
      vi.mocked(p.select).mockResolvedValueOnce('extend');
      // 2. Main menu: 'exit'
      vi.mocked(p.select).mockResolvedValueOnce('exit');

      await launchInteractiveDashboard({ configDir: tempDir });

      const cfg = getConfig({ configDir: tempDir });
      const record = cfg.throwaways?.['expired-ext'];
      expect(record).toBeDefined();
      expect(record?.ttlDays).toBe(4); // 1 + 3
      expect(new Date(record!.expiresAt).getTime()).toBeGreaterThan(
        new Date(initialExpiresAt).getTime()
      );
    });

    it('handles expired throwaways on dashboard launch by graduating scratchpad', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createThrowaway('expired-grad', 1, 'minimal', {
        configDir: tempDir,
        throwawaysRoot: throwawaysDir,
        now: pastDate,
      });

      const oldScratchPath = path.join(throwawaysDir, 'expired-grad');
      const graduatedPath = path.join(projectsDir, 'expired-grad');

      // 1. Expired handler action: 'graduate'
      vi.mocked(p.select).mockResolvedValueOnce('graduate');
      // 2. Main menu: 'exit'
      vi.mocked(p.select).mockResolvedValueOnce('exit');

      await launchInteractiveDashboard({ configDir: tempDir });

      expect(fs.existsSync(oldScratchPath)).toBe(false);
      expect(fs.existsSync(graduatedPath)).toBe(true);
      expect(fs.existsSync(path.join(graduatedPath, '.git'))).toBe(true);

      const cfg = getConfig({ configDir: tempDir });
      expect(cfg.throwaways?.['expired-grad']).toBeUndefined();
    });

    it('handles expired throwaways on dashboard launch by skipping', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createThrowaway('expired-skip', 1, 'minimal', {
        configDir: tempDir,
        throwawaysRoot: throwawaysDir,
        now: pastDate,
      });

      const scratchPath = path.join(throwawaysDir, 'expired-skip');

      // 1. Expired handler action: 'skip'
      vi.mocked(p.select).mockResolvedValueOnce('skip');
      // 2. Main menu: 'exit'
      vi.mocked(p.select).mockResolvedValueOnce('exit');

      await launchInteractiveDashboard({ configDir: tempDir });

      expect(fs.existsSync(scratchPath)).toBe(true);
      const cfg = getConfig({ configDir: tempDir });
      expect(cfg.throwaways?.['expired-skip']).toBeDefined();
    });

    it('handles expired throwaways cancellation gracefully', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createThrowaway('expired-cancel', 1, 'minimal', {
        configDir: tempDir,
        throwawaysRoot: throwawaysDir,
        now: pastDate,
      });

      // 1. Cancel expired prompt
      vi.mocked(p.select).mockResolvedValueOnce('__CANCEL__');

      await handleExpiredThrowaways({ configDir: tempDir });

      const cfg = getConfig({ configDir: tempDir });
      expect(cfg.throwaways?.['expired-cancel']).toBeDefined();
    });
  });
});
