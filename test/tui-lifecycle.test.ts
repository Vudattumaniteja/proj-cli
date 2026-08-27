import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import * as p from '@clack/prompts';
import { interactiveViewProjects } from '../src/tui/index.js';
import { updateConfig } from '../src/config/index.js';
import { scaffoldProject } from '../src/engine/scaffold.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
  execaSync: vi.fn(),
}));

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

describe('Interactive TUI Dashboard Project Actions (Publishing & Two-Tier Deletion)', () => {
  let tempDir: string;
  let projectsDir: string;
  let throwawaysDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-tui-actions-'));
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

    vi.mocked(execa).mockImplementation((async (
      file: string,
      args?: readonly string[],
      opts?: { cwd?: string }
    ) => {
      if (file === 'gh' && args?.[0] === 'repo' && args?.[1] === 'create') {
        const repoName = args?.[2] || 'test-app';
        const cwd = opts?.cwd;
        if (cwd) {
          try {
            const git = simpleGit(cwd);
            await git.addRemote('origin', `https://github.com/testowner/${repoName}.git`);
          } catch {
            // ignore
          }
        }
        return {
          stdout: `https://github.com/testowner/${repoName}\n`,
          stderr: '',
          exitCode: 0,
        } as unknown as ReturnType<typeof execa>;
      }

      if (file === 'gh' && args?.[0] === 'repo' && args?.[1] === 'delete') {
        return {
          stdout: 'Deleted repository\n',
          stderr: '',
          exitCode: 0,
        } as unknown as ReturnType<typeof execa>;
      }

      if (file === 'gh' && args?.[0] === 'browse') {
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
        } as unknown as ReturnType<typeof execa>;
      }

      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as unknown as ReturnType<typeof execa>;
    }) as unknown as typeof execa);
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

  describe('GitHub Remote Status Detection in Action Menu', () => {
    it('displays "☁️ Publish to GitHub (Private)" when project lacks remote origin', async () => {
      await scaffoldProject('local-project', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      // Select 'local-project', then back
      vi.mocked(p.select).mockResolvedValueOnce('local-project');
      vi.mocked(p.select).mockResolvedValueOnce('back');

      await interactiveViewProjects({ configDir: tempDir });

      const selectCalls = vi.mocked(p.select).mock.calls;
      expect(selectCalls.length).toBeGreaterThanOrEqual(2);

      const actionMenuCall = selectCalls[1][0] as any;
      const options = actionMenuCall.options;

      const publishOption = options.find((opt: any) =>
        opt.label?.includes('Publish to GitHub (Private)')
      );
      expect(publishOption).toBeDefined();
      expect(publishOption.label).toBe('☁️ Publish to GitHub (Private)');
      expect(publishOption.value).toBe('publish');

      const openOption = options.find((opt: any) =>
        opt.label?.includes('Open on GitHub')
      );
      expect(openOption).toBeUndefined();
    });

    it('displays "🌐 Open on GitHub" when project already has a remote origin', async () => {
      const proj = await scaffoldProject('github-project', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      const git = simpleGit(proj.path);
      await git.addRemote('origin', 'https://github.com/my-org/github-project.git');

      // Select 'github-project', then back
      vi.mocked(p.select).mockResolvedValueOnce('github-project');
      vi.mocked(p.select).mockResolvedValueOnce('back');

      await interactiveViewProjects({ configDir: tempDir });

      const selectCalls = vi.mocked(p.select).mock.calls;
      const actionMenuCall = selectCalls[1][0] as any;
      const options = actionMenuCall.options;

      const openOption = options.find((opt: any) =>
        opt.label?.includes('Open on GitHub')
      );
      expect(openOption).toBeDefined();
      expect(openOption.label).toBe('🌐 Open on GitHub');
      expect(openOption.value).toBe('open-github');

      const publishOption = options.find((opt: any) =>
        opt.label?.includes('Publish to GitHub (Private)')
      );
      expect(publishOption).toBeUndefined();
    });
  });

  describe('One-Click GitHub Publishing', () => {
    it('runs spinner, calls publishProject, and presents result note with repository URL', async () => {
      await scaffoldProject('publishable-project', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      // 1. Select project: 'publishable-project'
      vi.mocked(p.select).mockResolvedValueOnce('publishable-project');
      // 2. Select context action: 'publish'
      vi.mocked(p.select).mockResolvedValueOnce('publish');
      // 3. Subsequent list display: back to main dashboard
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      // Verify spinner was started and stopped
      expect(p.spinner).toHaveBeenCalled();

      // Verify result note was presented with repository URL
      expect(p.note).toHaveBeenCalled();
      const noteCalls = vi.mocked(p.note).mock.calls;
      const pubNote = noteCalls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('https://github.com/testowner/publishable-project')
      );
      expect(pubNote).toBeDefined();
    });
  });

  describe('Project Deletion Menu & Safety Confirmation Prompts', () => {
    it('includes "🗑️ Delete Project" in project inspection menu', async () => {
      await scaffoldProject('deletable-project', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      vi.mocked(p.select).mockResolvedValueOnce('deletable-project');
      vi.mocked(p.select).mockResolvedValueOnce('back');

      await interactiveViewProjects({ configDir: tempDir });

      const selectCalls = vi.mocked(p.select).mock.calls;
      const actionMenuCall = selectCalls[1][0] as any;
      const options = actionMenuCall.options;

      const deleteOption = options.find((opt: any) =>
        opt.label?.includes('Delete Project')
      );
      expect(deleteOption).toBeDefined();
      expect(deleteOption.label).toBe('🗑️ Delete Project');
      expect(deleteOption.value).toBe('delete');
    });

    it('prompts between "Delete locally only" and "Delete GitHub repo in cloud and locally" when project has GitHub remote', async () => {
      const proj = await scaffoldProject('cloud-delete-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });
      const git = simpleGit(proj.path);
      await git.addRemote('origin', 'https://github.com/testowner/cloud-delete-app.git');

      // 1. Select project: 'cloud-delete-app'
      vi.mocked(p.select).mockResolvedValueOnce('cloud-delete-app');
      // 2. Select action: 'delete'
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 3. Select deletion scope: 'cloud'
      vi.mocked(p.select).mockResolvedValueOnce('cloud');
      // 4. Confirm prompt
      vi.mocked(p.confirm).mockResolvedValueOnce(true);

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      // Verify deletion scope options
      const selectCalls = vi.mocked(p.select).mock.calls;
      const scopeCall = selectCalls[2][0] as any;
      const scopeOptions = scopeCall.options;

      expect(scopeOptions).toEqual([
        expect.objectContaining({
          value: 'local',
          label: 'Delete locally only',
        }),
        expect.objectContaining({
          value: 'cloud',
          label: 'Delete GitHub repo in cloud and locally',
        }),
      ]);

      // Verify confirmation prompt was shown
      expect(p.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Are you sure you want to delete this project? Press Enter to confirm.',
        })
      );

      // Verify cloud deletion was invoked
      expect(execa).toHaveBeenCalledWith(
        'gh',
        ['repo', 'delete', 'testowner/cloud-delete-app', '--yes'],
        expect.anything()
      );

      // Verify local directory was deleted
      expect(fs.existsSync(proj.path)).toBe(false);
    });

    it('deletes locally only without cloud deletion when "Delete locally only" is chosen', async () => {
      const proj = await scaffoldProject('local-delete-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });
      const git = simpleGit(proj.path);
      await git.addRemote('origin', 'https://github.com/testowner/local-delete-app.git');

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('local-delete-app');
      // 2. Action: delete
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 3. Scope: local
      vi.mocked(p.select).mockResolvedValueOnce('local');
      // 4. Confirm prompt
      vi.mocked(p.confirm).mockResolvedValueOnce(true);

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      // gh repo delete should NOT be called
      const deleteCalls = vi.mocked(execa).mock.calls.filter((call) => {
        const args = Array.isArray(call[1]) ? (call[1] as readonly string[]) : [];
        return call[0] === 'gh' && args[0] === 'repo' && args[1] === 'delete';
      });
      expect(deleteCalls.length).toBe(0);

      // Local folder removed
      expect(fs.existsSync(proj.path)).toBe(false);
    });

    it('skips cloud prompt when project has no remote, requiring explicit confirmation', async () => {
      const proj = await scaffoldProject('no-remote-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('no-remote-app');
      // 2. Action: delete
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 3. Confirm prompt
      vi.mocked(p.confirm).mockResolvedValueOnce(true);

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      // Verify no cloud scope prompt was presented among select calls
      const hasCloudScopeSelect = vi
        .mocked(p.select)
        .mock.calls.some((call) =>
          (call[0] as any)?.options?.some((opt: any) => opt.value === 'cloud')
        );
      expect(hasCloudScopeSelect).toBe(false);

      expect(p.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Are you sure you want to delete this project? Press Enter to confirm.',
        })
      );
      expect(fs.existsSync(proj.path)).toBe(false);
    });

    it('warns with modified file count and requires second confirmation if working tree is dirty', async () => {
      const proj = await scaffoldProject('dirty-project', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      // Create dirty uncommitted changes
      fs.writeFileSync(path.join(proj.path, 'uncommitted1.txt'), 'dirty content 1');
      fs.writeFileSync(path.join(proj.path, 'uncommitted2.txt'), 'dirty content 2');

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('dirty-project');
      // 2. Action: delete
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 3. First confirm: true
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      // 4. Second confirm (dirty warning): true
      vi.mocked(p.confirm).mockResolvedValueOnce(true);

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      // Verify warning log displayed with modified file count
      expect(p.log.warn).toHaveBeenCalled();
      const warnCall = vi.mocked(p.log.warn).mock.calls[0][0];
      expect(warnCall).toMatch(/2/);

      // Verify two confirm prompts were requested
      expect(vi.mocked(p.confirm).mock.calls.length).toBe(2);

      // Successfully deleted with force
      expect(fs.existsSync(proj.path)).toBe(false);
    });

    it('safely aborts without disk or cloud side-effects if user cancels at scope selection', async () => {
      const proj = await scaffoldProject('cancel-scope-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });
      const git = simpleGit(proj.path);
      await git.addRemote('origin', 'https://github.com/testowner/cancel-scope-app.git');

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('cancel-scope-app');
      // 2. Action: delete
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 3. Cancel at scope select
      vi.mocked(p.select).mockResolvedValueOnce('__CANCEL__');
      // 4. Subsequent list: back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      await interactiveViewProjects({ configDir: tempDir });

      expect(p.cancel).toHaveBeenCalledWith('Project deletion cancelled.');
      expect(fs.existsSync(proj.path)).toBe(true);
    });

    it('safely aborts without side-effects if user declines first confirmation', async () => {
      const proj = await scaffoldProject('decline-confirm-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('decline-confirm-app');
      // 2. Action: delete
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 3. First confirm: false
      vi.mocked(p.confirm).mockResolvedValueOnce(false);
      // 4. Back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      await interactiveViewProjects({ configDir: tempDir });

      expect(p.cancel).toHaveBeenCalledWith('Project deletion cancelled.');
      expect(fs.existsSync(proj.path)).toBe(true);
    });

    it('safely aborts without side-effects if user declines second dirty confirmation', async () => {
      const proj = await scaffoldProject('cancel-dirty-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      fs.writeFileSync(path.join(proj.path, 'dirty.txt'), 'dirty');

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('cancel-dirty-app');
      // 2. Action: delete
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // 3. First confirm: true
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      // 4. Second confirm (dirty warning): false
      vi.mocked(p.confirm).mockResolvedValueOnce(false);
      // 5. Back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      await interactiveViewProjects({ configDir: tempDir });

      expect(p.cancel).toHaveBeenCalledWith('Project deletion cancelled.');
      expect(fs.existsSync(proj.path)).toBe(true);
      expect(fs.existsSync(path.join(proj.path, 'dirty.txt'))).toBe(true);
    });
  });

  describe('Open on GitHub Action', () => {
    it('executes gh browse or displays repo note when "🌐 Open on GitHub" is selected', async () => {
      const proj = await scaffoldProject('browse-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });
      const git = simpleGit(proj.path);
      await git.addRemote('origin', 'https://github.com/testowner/browse-app.git');

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('browse-app');
      // 2. Action: open-github
      vi.mocked(p.select).mockResolvedValueOnce('open-github');
      // 3. Back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      await interactiveViewProjects({ configDir: tempDir });

      expect(execa).toHaveBeenCalledWith('gh', ['browse'], expect.objectContaining({ cwd: proj.path }));
    });
  });
});
