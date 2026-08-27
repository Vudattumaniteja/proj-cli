import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import {
  launchInteractiveDashboard,
  interactiveViewProjects,
  interactiveNewProject,
} from '../src/tui/index.js';
import { getConfig, updateConfig } from '../src/config/index.js';
import { readIpcToken } from '../src/ipc/index.js';
import { scaffoldProject } from '../src/engine/scaffold.js';
import { createGroup } from '../src/engine/organize.js';

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

describe('Interactive TUI Project Organizer & Drill-Down Browser (tui-groups)', () => {
  let tempDir: string;
  let projectsDir: string;
  let throwawaysDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-tui-groups-'));
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

  describe('Main Dashboard Menu Option', () => {
    it('displays "📂 Project Organizer & Browser" in main dashboard options', async () => {
      vi.mocked(p.select).mockResolvedValueOnce('exit');

      await launchInteractiveDashboard({ configDir: tempDir });

      expect(p.select).toHaveBeenCalled();
      const firstCall = vi.mocked(p.select).mock.calls[0][0] as any;
      const projectsOption = firstCall.options.find((opt: any) => opt.value === 'projects');
      expect(projectsOption).toBeDefined();
      expect(projectsOption.label).toBe('📂 Project Organizer & Browser');
    });
  });

  describe('Top-Level Menu Group Display & Group Creation', () => {
    it('displays group folders with project counts and standalone root projects', async () => {
      // 1. Create root standalone project
      await scaffoldProject('root-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      // 2. Create group with 2 projects
      await scaffoldProject('bot-1', 'typescript', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'Hackathons',
      });
      await scaffoldProject('bot-2', 'python', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'Hackathons',
      });

      // 3. Create empty group
      await createGroup('utilities', {
        configDir: tempDir,
        projectsRoot: projectsDir,
      });

      // Select Back to exit
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      const selectCalls = vi.mocked(p.select).mock.calls;
      const menuOptions = (selectCalls[0][0] as any).options;

      // Check group folder with 2 projects
      const hackGroupOpt = menuOptions.find((opt: any) => opt.value === 'group:Hackathons');
      expect(hackGroupOpt).toBeDefined();
      expect(hackGroupOpt.label).toContain('📁 Hackathons (2 projects)');

      // Check empty group folder with 0 projects
      const utilGroupOpt = menuOptions.find((opt: any) => opt.value === 'group:utilities');
      expect(utilGroupOpt).toBeDefined();
      expect(utilGroupOpt.label).toContain('📁 utilities (0 projects)');

      // Check standalone root project
      const rootAppOpt = menuOptions.find((opt: any) => opt.value === 'root-app');
      expect(rootAppOpt).toBeDefined();
      expect(rootAppOpt.label).toContain('root-app');

      // Check Create New Group action option
      const newGroupOpt = menuOptions.find((opt: any) => opt.value === '__new_group__');
      expect(newGroupOpt).toBeDefined();
      expect(newGroupOpt.label).toContain('Create New Group');
    });

    it('creates a new group directory from the top-level menu action', async () => {
      // 1. Select '__new_group__'
      vi.mocked(p.select).mockResolvedValueOnce('__new_group__');
      // 2. Text input: group name
      vi.mocked(p.text).mockResolvedValueOnce('cloud-services');
      // 3. Next iteration: select '__back__'
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      const createdGroupPath = path.join(projectsDir, 'cloud-services');
      expect(fs.existsSync(createdGroupPath)).toBe(true);
      expect(fs.statSync(createdGroupPath).isDirectory()).toBe(true);
      expect(p.note).toHaveBeenCalled();
    });
  });

  describe('Group Drill-Down Navigation & Quick Actions', () => {
    beforeEach(async () => {
      // Group with 2 projects
      await scaffoldProject('hack-bot', 'typescript', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'Hackathons',
      });
      await scaffoldProject('hack-api', 'python', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'Hackathons',
      });
      // Root project
      await scaffoldProject('other-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });
    });

    it('drills down to display only projects in selected group and includes quick actions', async () => {
      // 1. Select 'group:Hackathons'
      vi.mocked(p.select).mockResolvedValueOnce('group:Hackathons');
      // 2. In group view, select '↩ Back to Groups'
      vi.mocked(p.select).mockResolvedValueOnce('__back_groups__');
      // 3. In top-level menu, select '__back__'
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      const selectCalls = vi.mocked(p.select).mock.calls;
      expect(selectCalls.length).toBeGreaterThanOrEqual(2);

      const groupViewCall = selectCalls[1][0] as any;
      const options = groupViewCall.options;

      // Should show only projects in Hackathons
      expect(options.some((opt: any) => opt.value === 'hack-bot')).toBe(true);
      expect(options.some((opt: any) => opt.value === 'hack-api')).toBe(true);
      expect(options.some((opt: any) => opt.value === 'other-app')).toBe(false);

      // Quick actions
      expect(options.some((opt: any) => opt.value === '__new_project_in_group__')).toBe(true);
      expect(options.some((opt: any) => opt.value === '__jump_group__')).toBe(true);
      expect(options.some((opt: any) => opt.value === '__back_groups__')).toBe(true);
    });

    it('jumps to group folder via quick action emitting cd IPC token', async () => {
      // 1. Select group:Hackathons
      vi.mocked(p.select).mockResolvedValueOnce('group:Hackathons');
      // 2. Select '__jump_group__'
      vi.mocked(p.select).mockResolvedValueOnce('__jump_group__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('exit');

      const token = readIpcToken({ configDir: tempDir });
      expect(token?.action).toBe('cd');
      expect(token?.targetPath).toBe(path.resolve(path.join(projectsDir, 'Hackathons')));
    });

    it('scaffolds a new project inside the group via quick action', async () => {
      // 1. Select group:Hackathons
      vi.mocked(p.select).mockResolvedValueOnce('group:Hackathons');
      // 2. Select '__new_project_in_group__'
      vi.mocked(p.select).mockResolvedValueOnce('__new_project_in_group__');
      // 3. New project name (interactiveNewProject prompt)
      vi.mocked(p.text).mockResolvedValueOnce('quick-tool');
      // 4. Template selection (interactiveNewProject prompt)
      vi.mocked(p.select).mockResolvedValueOnce('minimal');
      // 5. Next step in wizard: done
      vi.mocked(p.select).mockResolvedValueOnce('done');
      // 6. Group view after creation: back to groups
      vi.mocked(p.select).mockResolvedValueOnce('__back_groups__');
      // 7. Top menu: back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      const createdPath = path.join(projectsDir, 'Hackathons', 'quick-tool');
      expect(fs.existsSync(createdPath)).toBe(true);
      expect(fs.existsSync(path.join(createdPath, 'AGENTS.md'))).toBe(true);
    });
  });

  describe('Project Context Action Menu - Move to Another Group / Root', () => {
    it('relocates project from root workspace to an existing group', async () => {
      await scaffoldProject('standalone-proj', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });
      await createGroup('backend-services', {
        configDir: tempDir,
        projectsRoot: projectsDir,
      });

      // 1. Select project 'standalone-proj'
      vi.mocked(p.select).mockResolvedValueOnce('standalone-proj');
      // 2. Select context action 'move'
      vi.mocked(p.select).mockResolvedValueOnce('move');
      // 3. Select destination group 'backend-services'
      vi.mocked(p.select).mockResolvedValueOnce('backend-services');
      // 4. Next iteration top-level menu: select '__back__'
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      expect(fs.existsSync(path.join(projectsDir, 'backend-services', 'standalone-proj'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'standalone-proj'))).toBe(false);
    });

    it('relocates project from a group to root workspace and auto-prunes empty group', async () => {
      await scaffoldProject('grouped-proj', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'temporary-group',
      });

      // 1. Select 'group:temporary-group'
      vi.mocked(p.select).mockResolvedValueOnce('group:temporary-group');
      // 2. Select 'grouped-proj'
      vi.mocked(p.select).mockResolvedValueOnce('grouped-proj');
      // 3. Select 'move'
      vi.mocked(p.select).mockResolvedValueOnce('move');
      // 4. Select destination '__root__'
      vi.mocked(p.select).mockResolvedValueOnce('__root__');
      // 5. Next iteration: back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const result = await interactiveViewProjects({ configDir: tempDir });
      expect(result).toBe('back');

      expect(fs.existsSync(path.join(projectsDir, 'grouped-proj'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'temporary-group'))).toBe(false);
    });

    it('creates a new group on the fly during move action and relocates project', async () => {
      await scaffoldProject('fly-proj', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });

      // 1. Select project
      vi.mocked(p.select).mockResolvedValueOnce('fly-proj');
      // 2. Select action: 'move'
      vi.mocked(p.select).mockResolvedValueOnce('move');
      // 3. Select destination: '__new_group__'
      vi.mocked(p.select).mockResolvedValueOnce('__new_group__');
      // 4. Text input: new group name
      vi.mocked(p.text).mockResolvedValueOnce('brand-new-group');
      // 5. Next iteration: back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      await interactiveViewProjects({ configDir: tempDir });

      expect(fs.existsSync(path.join(projectsDir, 'brand-new-group', 'fly-proj'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'fly-proj'))).toBe(false);
    });
  });

  describe('interactiveNewProject Wizard Destination Selection', () => {
    it('prompts for destination [Root] and creates standalone root project', async () => {
      // 1. Name
      vi.mocked(p.text).mockResolvedValueOnce('root-scaffolded-app');
      // 2. Destination: [Root]
      vi.mocked(p.select).mockResolvedValueOnce('__root__');
      // 3. Template
      vi.mocked(p.select).mockResolvedValueOnce('typescript');
      // 4. Next action: done
      vi.mocked(p.select).mockResolvedValueOnce('done');

      await interactiveNewProject({ configDir: tempDir });

      const target = path.join(projectsDir, 'root-scaffolded-app');
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.existsSync(path.join(target, 'tsconfig.json'))).toBe(true);
    });

    it('prompts for destination with existing groups and creates grouped project', async () => {
      await createGroup('mobile-apps', {
        configDir: tempDir,
        projectsRoot: projectsDir,
      });

      // 1. Name
      vi.mocked(p.text).mockResolvedValueOnce('ios-client');
      // 2. Destination: 'mobile-apps'
      vi.mocked(p.select).mockResolvedValueOnce('mobile-apps');
      // 3. Template
      vi.mocked(p.select).mockResolvedValueOnce('web');
      // 4. Next action: done
      vi.mocked(p.select).mockResolvedValueOnce('done');

      await interactiveNewProject({ configDir: tempDir });

      const target = path.join(projectsDir, 'mobile-apps', 'ios-client');
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.existsSync(path.join(target, 'index.html'))).toBe(true);
    });

    it('prompts for destination and creates on-the-fly group with "➕ New group..." option', async () => {
      // 1. Name
      vi.mocked(p.text).mockResolvedValueOnce('vision-model');
      // 2. Destination: '__new_group__'
      vi.mocked(p.select).mockResolvedValueOnce('__new_group__');
      // 3. Text prompt for new group name
      vi.mocked(p.text).mockResolvedValueOnce('ai-research');
      // 4. Template
      vi.mocked(p.select).mockResolvedValueOnce('python');
      // 5. Next action: done
      vi.mocked(p.select).mockResolvedValueOnce('done');

      await interactiveNewProject({ configDir: tempDir });

      const target = path.join(projectsDir, 'ai-research', 'vision-model');
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.existsSync(path.join(target, 'pyproject.toml'))).toBe(true);
    });
  });
});
