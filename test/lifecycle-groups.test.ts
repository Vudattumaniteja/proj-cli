import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import * as p from '@clack/prompts';
import {
  listProjects,
  listGroups,
  resolveProject,
  inspectProject,
} from '../src/engine/discovery.js';
import { scaffoldProject } from '../src/engine/scaffold.js';
import {
  createGroup,
  deleteGroup,
  moveProject,
  validateGroupName,
} from '../src/engine/organize.js';
import { deleteProject } from '../src/engine/delete.js';
import { createProgram } from '../src/index.js';
import { updateConfig } from '../src/config/index.js';
import { readIpcToken } from '../src/ipc/index.js';
import {
  interactiveViewProjects,
  interactiveNewProject,
} from '../src/tui/index.js';

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

describe('Subfolder Groups End-to-End Lifecycle & Collision Test Suite (lifecycle-groups)', () => {
  let tempDir: string;
  let projectsDir: string;
  let throwawaysDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-lifecycle-groups-'));
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

  describe('Phase 1: Engine Seam Complete Lifecycle (Create -> Scaffold -> Discover -> Resolve -> Move -> Delete -> Auto-Prune)', () => {
    it('executes full grouped project lifecycle through engine functions', async () => {
      // 1. Create Group
      const groupResult = await createGroup('ai-agents', {
        configDir: tempDir,
        projectsRoot: projectsDir,
      });
      expect(groupResult.name).toBe('ai-agents');
      expect(fs.existsSync(groupResult.path)).toBe(true);

      // 2. Scaffold in Group
      const scaffoldResult = await scaffoldProject('agent-runner', 'typescript', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'ai-agents',
      });
      expect(scaffoldResult.name).toBe('agent-runner');
      expect(scaffoldResult.group).toBe('ai-agents');
      expect(fs.existsSync(path.join(scaffoldResult.path, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(scaffoldResult.path, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(scaffoldResult.path, '.git'))).toBe(true);

      // 3. Discovery: listProjects & listGroups
      const allProjects = await listProjects(projectsDir, { throwawaysRoot: throwawaysDir });
      expect(allProjects).toHaveLength(1);
      expect(allProjects[0].name).toBe('agent-runner');
      expect(allProjects[0].group).toBe('ai-agents');
      expect(allProjects[0].templateType).toBe('typescript');

      const allGroups = await listGroups(projectsDir, { throwawaysRoot: throwawaysDir });
      expect(allGroups).toHaveLength(1);
      expect(allGroups[0].name).toBe('ai-agents');
      expect(allGroups[0].projectCount).toBe(1);
      expect(allGroups[0].projects[0].name).toBe('agent-runner');

      // 4. Resolution
      const resByFullName = await resolveProject('ai-agents/agent-runner', projectsDir, {
        throwawaysRoot: throwawaysDir,
      });
      expect(resByFullName.resolved).toBe(true);
      expect(resByFullName.type).toBe('project');
      expect(resByFullName.project?.name).toBe('agent-runner');
      expect(resByFullName.project?.group).toBe('ai-agents');

      const resByShortName = await resolveProject('agent-runner', projectsDir, {
        throwawaysRoot: throwawaysDir,
      });
      expect(resByShortName.resolved).toBe(true);
      expect(resByShortName.project?.name).toBe('agent-runner');

      const resGroupDir = await resolveProject('ai-agents', projectsDir, {
        throwawaysRoot: throwawaysDir,
      });
      expect(resGroupDir.resolved).toBe(true);
      expect(resGroupDir.type).toBe('group');
      expect(resGroupDir.group?.name).toBe('ai-agents');

      // 5. Move to Another Group (ai-agents -> production-services)
      const moveResult = await moveProject('agent-runner', 'production-services', {
        configDir: tempDir,
        projectsRoot: projectsDir,
        throwawaysRoot: throwawaysDir,
      });
      expect(moveResult.name).toBe('agent-runner');
      expect(moveResult.group).toBe('production-services');
      expect(moveResult.previousGroup).toBe('ai-agents');
      expect(fs.existsSync(moveResult.path)).toBe(true);
      // Auto-pruning empty source group
      expect(fs.existsSync(path.join(projectsDir, 'ai-agents'))).toBe(false);

      // Verify Git integrity after move
      const git = simpleGit(moveResult.path);
      const isRepo = await git.checkIsRepo();
      expect(isRepo).toBe(true);
      const log = await git.log();
      expect(log.total).toBeGreaterThanOrEqual(1);

      // 6. Delete Project and Auto-Prune Destination Group
      const deleteResult = await deleteProject('production-services/agent-runner', {
        configDir: tempDir,
        projectsRoot: projectsDir,
        throwawaysRoot: throwawaysDir,
      });
      expect(deleteResult.name).toBe('agent-runner');
      expect(deleteResult.groupPruned).toBe(true);
      expect(deleteResult.prunedGroup).toBe('production-services');
      expect(fs.existsSync(moveResult.path)).toBe(false);
      expect(fs.existsSync(path.join(projectsDir, 'production-services'))).toBe(false);
    });
  });

  describe('Phase 2: Collision Handling & Multi-Group Disambiguation', () => {
    beforeEach(async () => {
      // Create projects with identical name in 2 groups and at root:
      // projects/hackathons/worker-bot
      // projects/web-tools/worker-bot
      // projects/worker-bot (root)
      await scaffoldProject('worker-bot', 'typescript', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'hackathons',
      });
      await scaffoldProject('worker-bot', 'python', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'web-tools',
      });
      await scaffoldProject('worker-bot', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
      });
    });

    it('identifies ambiguous collisions when resolving unqualified duplicate names', async () => {
      const result = await resolveProject('worker-bot', projectsDir, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(false);
      expect(result.targetPath).toBeNull();
      expect(result.isAmbiguous).toBe(true);
      expect(result.ambiguousMatches).toHaveLength(3);

      const paths = result.ambiguousMatches.map((m) => m.path).sort();
      expect(paths).toEqual([
        path.resolve(path.join(projectsDir, 'hackathons', 'worker-bot')),
        path.resolve(path.join(projectsDir, 'web-tools', 'worker-bot')),
        path.resolve(path.join(projectsDir, 'worker-bot')),
      ].sort());
    });

    it('resolves unambiguously when group-qualified path is supplied', async () => {
      const hackRes = await resolveProject('hackathons/worker-bot', projectsDir, {
        throwawaysRoot: throwawaysDir,
      });
      expect(hackRes.resolved).toBe(true);
      expect(hackRes.project?.group).toBe('hackathons');
      expect(hackRes.project?.templateType).toBe('typescript');

      const webRes = await resolveProject('web-tools/worker-bot', projectsDir, {
        throwawaysRoot: throwawaysDir,
      });
      expect(webRes.resolved).toBe(true);
      expect(webRes.project?.group).toBe('web-tools');
      expect(webRes.project?.templateType).toBe('python');
    });

    it('throws descriptive ambiguity error when attempting to move unqualified duplicate project', async () => {
      await expect(
        moveProject('worker-bot', 'archived', {
          configDir: tempDir,
          projectsRoot: projectsDir,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/Ambiguous project name "worker-bot"/i);
    });

    it('successfully relocates qualified duplicate project and preserves remaining collisions', async () => {
      const moveRes = await moveProject('hackathons/worker-bot', 'archived', {
        configDir: tempDir,
        projectsRoot: projectsDir,
        throwawaysRoot: throwawaysDir,
      });

      expect(moveRes.name).toBe('worker-bot');
      expect(moveRes.group).toBe('archived');
      expect(fs.existsSync(path.join(projectsDir, 'archived', 'worker-bot'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'hackathons'))).toBe(false); // pruned empty group

      // Remaining 2 projects still exist
      expect(fs.existsSync(path.join(projectsDir, 'web-tools', 'worker-bot'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'worker-bot'))).toBe(true);
    });

    it('rejects moving when destination already contains a project of the same name', async () => {
      await expect(
        moveProject('web-tools/worker-bot', 'root', {
          configDir: tempDir,
          projectsRoot: projectsDir,
          throwawaysRoot: throwawaysDir,
        })
      ).rejects.toThrow(/Destination path already exists/i);
    });
  });

  describe('Phase 3: CLI Programmatic Commands Lifecycle & IPC Verification', () => {
    it('executes full CLI command chain with IPC token emission', async () => {
      const program = createProgram();
      let stdoutLog = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdoutLog += chunk.toString();
        return true;
      }) as any;

      try {
        // 1. proj new
        await program.parseAsync(['node', 'proj', 'new', 'cloud-apps/serverless-api', '-t', 'web']);
        expect(stdoutLog).toContain('Successfully created project "serverless-api"');
        const projPath = path.join(projectsDir, 'cloud-apps', 'serverless-api');
        expect(fs.existsSync(projPath)).toBe(true);

        // 2. proj list --json
        stdoutLog = '';
        await program.parseAsync(['node', 'proj', 'list', '--json']);
        const listJson = JSON.parse(stdoutLog.trim());
        const entry = listJson.find((p: any) => p.name === 'serverless-api');
        expect(entry).toBeDefined();
        expect(entry.group).toBe('cloud-apps');

        // 3. proj cd serverless-api
        stdoutLog = '';
        await program.parseAsync(['node', 'proj', 'cd', 'serverless-api']);
        expect(stdoutLog).toContain('Jumping to project "serverless-api"');
        const token1 = readIpcToken({ configDir: tempDir });
        expect(token1?.action).toBe('cd');
        expect(token1?.targetPath).toBe(path.resolve(projPath));

        // 4. proj code cloud-apps
        stdoutLog = '';
        await program.parseAsync(['node', 'proj', 'code', 'cloud-apps']);
        expect(stdoutLog).toContain('Opening project "cloud-apps" in VS Code');
        const token2 = readIpcToken({ configDir: tempDir });
        expect(token2?.action).toBe('code');
        expect(token2?.targetPath).toBe(path.resolve(path.join(projectsDir, 'cloud-apps')));

        // 5. proj move serverless-api legacy-services
        stdoutLog = '';
        await program.parseAsync(['node', 'proj', 'move', 'serverless-api', 'legacy-services']);
        expect(stdoutLog).toContain('Successfully moved project "serverless-api" to group "legacy-services"');
        const movedPath = path.join(projectsDir, 'legacy-services', 'serverless-api');
        expect(fs.existsSync(movedPath)).toBe(true);
        expect(fs.existsSync(path.join(projectsDir, 'cloud-apps'))).toBe(false);

        // 6. proj delete legacy-services/serverless-api
        stdoutLog = '';
        await program.parseAsync(['node', 'proj', 'delete', 'legacy-services/serverless-api']);
        expect(stdoutLog).toContain('Successfully deleted project "serverless-api"');
        expect(fs.existsSync(movedPath)).toBe(false);
        expect(fs.existsSync(path.join(projectsDir, 'legacy-services'))).toBe(false);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    it('rejects ambiguous CLI navigation commands with exitCode 1 and diagnostic stderr', async () => {
      // Create colliding projects
      await scaffoldProject('shared-cli-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'group-x',
      });
      await scaffoldProject('shared-cli-app', 'minimal', {
        configDir: tempDir,
        parentDir: projectsDir,
        group: 'group-y',
      });

      const program = createProgram();
      let stderrLog = '';
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderrLog += chunk.toString();
        return true;
      }) as any;

      try {
        // proj cd shared-cli-app
        await program.parseAsync(['node', 'proj', 'cd', 'shared-cli-app']);
        expect(stderrLog).toContain('Ambiguous project name "shared-cli-app"');
        expect(stderrLog).toContain('group-x/shared-cli-app');
        expect(stderrLog).toContain('group-y/shared-cli-app');
        expect(process.exitCode).toBe(1);

        // proj code shared-cli-app
        stderrLog = '';
        process.exitCode = 0;
        await program.parseAsync(['node', 'proj', 'code', 'shared-cli-app']);
        expect(stderrLog).toContain('Ambiguous project name "shared-cli-app"');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = origErr;
        process.exitCode = 0;
      }
    });
  });

  describe('Phase 4: Clack Interactive TUI Group Lifecycle Integration', () => {
    it('supports interactive creation, drill-down, relocation, and deletion inside TUI', async () => {
      // 1. Interactive Create New Project in New Group via wizard
      vi.mocked(p.text).mockResolvedValueOnce('tui-service');
      vi.mocked(p.select).mockResolvedValueOnce('__new_group__');
      vi.mocked(p.text).mockResolvedValueOnce('infra-tools');
      vi.mocked(p.select).mockResolvedValueOnce('minimal');
      vi.mocked(p.select).mockResolvedValueOnce('done');

      await interactiveNewProject({ configDir: tempDir });
      const createdPath = path.join(projectsDir, 'infra-tools', 'tui-service');
      expect(fs.existsSync(createdPath)).toBe(true);

      // 2. Interactive Drill-Down into group and move project
      // Top menu: Select 'group:infra-tools'
      vi.mocked(p.select).mockResolvedValueOnce('group:infra-tools');
      // Group menu: Select 'tui-service'
      vi.mocked(p.select).mockResolvedValueOnce('tui-service');
      // Action menu: Select 'move'
      vi.mocked(p.select).mockResolvedValueOnce('move');
      // Destination: Select '__root__'
      vi.mocked(p.select).mockResolvedValueOnce('__root__');
      // Next top iteration: Back
      vi.mocked(p.select).mockResolvedValueOnce('__back__');

      const moveRes = await interactiveViewProjects({ configDir: tempDir });
      expect(moveRes).toBe('back');

      // Moved to root, source group auto-pruned
      const rootPath = path.join(projectsDir, 'tui-service');
      expect(fs.existsSync(rootPath)).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'infra-tools'))).toBe(false);

      // 3. Interactive Deletion from Root
      // Top menu: Select 'tui-service'
      vi.mocked(p.select).mockResolvedValueOnce('tui-service');
      // Action menu: Select 'delete'
      vi.mocked(p.select).mockResolvedValueOnce('delete');
      // Confirm: true
      vi.mocked(p.confirm).mockResolvedValueOnce(true);

      const deleteRes = await interactiveViewProjects({ configDir: tempDir });
      expect(deleteRes).toBe('back');
      expect(fs.existsSync(rootPath)).toBe(false);
    });
  });
});
