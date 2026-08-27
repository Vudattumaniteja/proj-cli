import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import {
  listProjects,
  listGroups,
  resolveProject,
  inspectProject,
  type ProjectInfo,
  type GroupInfo,
  type ResolveProjectResult,
} from '../src/engine/discovery.js';

describe('Subfolder Group Scanning & Project Resolution Engine', () => {
  let tempRoot: string;
  let canonicalProjects: string;
  let throwawaysDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-groups-'));
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

  describe('inspectProject with group metadata', () => {
    it('attaches group metadata when group option is provided', async () => {
      const projDir = path.join(canonicalProjects, 'hackathons', 'agent-bot');
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ name: 'agent-bot' }));

      const info = await inspectProject(projDir, { group: 'hackathons' });
      expect(info.name).toBe('agent-bot');
      expect(info.path).toBe(path.resolve(projDir));
      expect(info.group).toBe('hackathons');
      expect(info.isThrowaway).toBe(false);
    });

    it('leaves group undefined for standalone root projects', async () => {
      const projDir = path.join(canonicalProjects, 'root-app');
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ name: 'root-app' }));

      const info = await inspectProject(projDir);
      expect(info.name).toBe('root-app');
      expect(info.group).toBeUndefined();
    });
  });

  describe('listProjects with 1-level group subfolders', () => {
    it('discovers both root projects and 1-level grouped projects', async () => {
      // 1. Root project
      const rootProj = path.join(canonicalProjects, 'standalone-app');
      fs.mkdirSync(rootProj, { recursive: true });
      fs.writeFileSync(path.join(rootProj, 'tsconfig.json'), '{}');

      // 2. Group folder with 2 projects
      const groupDir = path.join(canonicalProjects, 'hackathons');
      const groupProj1 = path.join(groupDir, 'ai-judge');
      const groupProj2 = path.join(groupDir, 'mcp-agent');
      fs.mkdirSync(groupProj1, { recursive: true });
      fs.mkdirSync(groupProj2, { recursive: true });
      fs.writeFileSync(path.join(groupProj1, 'pyproject.toml'), '# python');
      fs.writeFileSync(path.join(groupProj2, 'package.json'), JSON.stringify({ name: 'mcp-agent' }));

      // 3. Throwaway project
      const throwawayProj = path.join(throwawaysDir, 'quick-spike');
      fs.mkdirSync(throwawayProj, { recursive: true });

      const projects = await listProjects(canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(projects).toHaveLength(4);

      const standalone = projects.find((p) => p.name === 'standalone-app')!;
      expect(standalone).toBeDefined();
      expect(standalone.group).toBeUndefined();
      expect(standalone.isThrowaway).toBe(false);
      expect(standalone.templateType).toBe('typescript');

      const aiJudge = projects.find((p) => p.name === 'ai-judge')!;
      expect(aiJudge).toBeDefined();
      expect(aiJudge.group).toBe('hackathons');
      expect(aiJudge.path).toBe(path.resolve(groupProj1));
      expect(aiJudge.isThrowaway).toBe(false);
      expect(aiJudge.templateType).toBe('python');

      const mcpAgent = projects.find((p) => p.name === 'mcp-agent')!;
      expect(mcpAgent).toBeDefined();
      expect(mcpAgent.group).toBe('hackathons');
      expect(mcpAgent.path).toBe(path.resolve(groupProj2));
      expect(mcpAgent.isThrowaway).toBe(false);
      expect(mcpAgent.templateType).toBe('node');

      const quickSpike = projects.find((p) => p.name === 'quick-spike')!;
      expect(quickSpike).toBeDefined();
      expect(quickSpike.group).toBeUndefined();
      expect(quickSpike.isThrowaway).toBe(true);
    });

    it('safely excludes reserved folder names (.git, throwaways, .proj, node_modules, dist)', async () => {
      // Create reserved directories at root
      fs.mkdirSync(path.join(canonicalProjects, 'node_modules', 'some-pkg'), { recursive: true });
      fs.mkdirSync(path.join(canonicalProjects, 'dist', 'bundle'), { recursive: true });
      fs.mkdirSync(path.join(canonicalProjects, '.proj', 'cache'), { recursive: true });
      fs.mkdirSync(path.join(canonicalProjects, '.hidden-dir', 'sub'), { recursive: true });

      // Valid project in group
      const validGroup = path.join(canonicalProjects, 'web-mcp');
      const validProj = path.join(validGroup, 'mcp-server');
      fs.mkdirSync(validProj, { recursive: true });
      fs.writeFileSync(path.join(validProj, 'package.json'), '{}');

      // Reserved folders inside group
      fs.mkdirSync(path.join(validGroup, 'node_modules', 'foo'), { recursive: true });
      fs.mkdirSync(path.join(validGroup, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(validGroup, '.hidden-folder'), { recursive: true });

      const projects = await listProjects(canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('mcp-server');
      expect(projects[0].group).toBe('web-mcp');
    });

    it('treats root folders with .git as root projects, not group containers', async () => {
      const gitRepo = path.join(canonicalProjects, 'git-monorepo');
      fs.mkdirSync(gitRepo, { recursive: true });
      fs.mkdirSync(path.join(gitRepo, 'packages', 'pkg-a'), { recursive: true });
      fs.writeFileSync(path.join(gitRepo, 'package.json'), '{}');

      const git = simpleGit(gitRepo);
      await git.init();
      await git.addConfig('user.name', 'Tester');
      await git.addConfig('user.email', 'tester@example.com');
      await git.add('.');
      await git.commit('init monorepo');

      const projects = await listProjects(canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('git-monorepo');
      expect(projects[0].group).toBeUndefined();
      expect(projects[0].isGit).toBe(true);
    });

    it('safely handles empty group folders without crashing or returning empty entries', async () => {
      const emptyGroup = path.join(canonicalProjects, 'empty-group');
      fs.mkdirSync(emptyGroup, { recursive: true });

      const projects = await listProjects(canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(projects).toHaveLength(0);
    });
  });

  describe('listGroups', () => {
    it('returns empty array when no group folders exist', async () => {
      const rootProj = path.join(canonicalProjects, 'my-app');
      fs.mkdirSync(rootProj, { recursive: true });
      fs.writeFileSync(path.join(rootProj, 'tsconfig.json'), '{}');

      const groups = await listGroups(canonicalProjects);
      expect(groups).toEqual([]);
    });

    it('returns detected group folders with their child projects', async () => {
      // Group 1: hackathons with 2 projects
      const hackathonsDir = path.join(canonicalProjects, 'hackathons');
      const bot1 = path.join(hackathonsDir, 'bot-alpha');
      const bot2 = path.join(hackathonsDir, 'bot-beta');
      fs.mkdirSync(bot1, { recursive: true });
      fs.mkdirSync(bot2, { recursive: true });
      fs.writeFileSync(path.join(bot1, 'package.json'), '{}');
      fs.writeFileSync(path.join(bot2, 'pyproject.toml'), '');

      // Group 2: client-work with 1 project
      const clientDir = path.join(canonicalProjects, 'client-work');
      const clientProj = path.join(clientDir, 'portal');
      fs.mkdirSync(clientProj, { recursive: true });
      fs.writeFileSync(path.join(clientProj, 'Cargo.toml'), '');

      // Root project (should NOT appear as a group)
      const rootProj = path.join(canonicalProjects, 'root-site');
      fs.mkdirSync(rootProj, { recursive: true });
      fs.writeFileSync(path.join(rootProj, 'index.html'), '');

      const groups = await listGroups(canonicalProjects);

      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name)).toEqual(['client-work', 'hackathons']);

      const hackathons = groups.find((g) => g.name === 'hackathons')!;
      expect(hackathons.path).toBe(path.resolve(hackathonsDir));
      expect(hackathons.projectCount).toBe(2);
      expect(hackathons.projects).toHaveLength(2);
      expect(hackathons.projects.map((p) => p.name)).toEqual(['bot-alpha', 'bot-beta']);
      expect(hackathons.projects[0].group).toBe('hackathons');

      const client = groups.find((g) => g.name === 'client-work')!;
      expect(client.path).toBe(path.resolve(clientDir));
      expect(client.projectCount).toBe(1);
      expect(client.projects[0].name).toBe('portal');
      expect(client.projects[0].group).toBe('client-work');
    });

    it('returns empty group container with projectCount = 0 and projects = []', async () => {
      const emptyGroup = path.join(canonicalProjects, 'empty-category');
      fs.mkdirSync(emptyGroup, { recursive: true });

      const groups = await listGroups(canonicalProjects);

      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('empty-category');
      expect(groups[0].path).toBe(path.resolve(emptyGroup));
      expect(groups[0].projectCount).toBe(0);
      expect(groups[0].projects).toEqual([]);
    });

    it('excludes reserved folders from group list', async () => {
      fs.mkdirSync(path.join(canonicalProjects, 'throwaways'), { recursive: true });
      fs.mkdirSync(path.join(canonicalProjects, 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(canonicalProjects, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(canonicalProjects, '.git'), { recursive: true });

      const groups = await listGroups(canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(groups).toEqual([]);
    });
  });

  describe('resolveProject', () => {
    beforeEach(async () => {
      // Set up test workspace structure:
      // projects/
      //   root-tool/ (root project)
      //   duplicate-name/ (root project)
      //   hackathons/ (group)
      //     bot/
      //     duplicate-name/
      //   ai-tools/ (group)
      //     duplicate-name/
      //     agent/
      //   empty-group/ (group)
      //   throwaways/
      //     scratch-test/

      const rootTool = path.join(canonicalProjects, 'root-tool');
      fs.mkdirSync(rootTool, { recursive: true });
      fs.writeFileSync(path.join(rootTool, 'package.json'), '{}');

      const rootDup = path.join(canonicalProjects, 'duplicate-name');
      fs.mkdirSync(rootDup, { recursive: true });
      fs.writeFileSync(path.join(rootDup, 'package.json'), '{}');

      const hackathons = path.join(canonicalProjects, 'hackathons');
      const bot = path.join(hackathons, 'bot');
      const hackDup = path.join(hackathons, 'duplicate-name');
      fs.mkdirSync(bot, { recursive: true });
      fs.mkdirSync(hackDup, { recursive: true });
      fs.writeFileSync(path.join(bot, 'package.json'), '{}');
      fs.writeFileSync(path.join(hackDup, 'package.json'), '{}');

      const aiTools = path.join(canonicalProjects, 'ai-tools');
      const aiDup = path.join(aiTools, 'duplicate-name');
      const agent = path.join(aiTools, 'agent');
      fs.mkdirSync(aiDup, { recursive: true });
      fs.mkdirSync(agent, { recursive: true });
      fs.writeFileSync(path.join(aiDup, 'package.json'), '{}');
      fs.writeFileSync(path.join(agent, 'package.json'), '{}');

      const emptyGroup = path.join(canonicalProjects, 'empty-group');
      fs.mkdirSync(emptyGroup, { recursive: true });

      const scratchTest = path.join(throwawaysDir, 'scratch-test');
      fs.mkdirSync(scratchTest, { recursive: true });
    });

    it('resolves exact group-qualified path (hackathons/bot)', async () => {
      const result = await resolveProject('hackathons/bot', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(canonicalProjects, 'hackathons', 'bot')));
      expect(result.type).toBe('project');
      expect(result.project?.name).toBe('bot');
      expect(result.project?.group).toBe('hackathons');
      expect(result.isAmbiguous).toBe(false);
      expect(result.ambiguousMatches).toEqual([]);
    });

    it('resolves exact group-qualified path with Windows backslashes (hackathons\\bot)', async () => {
      const result = await resolveProject('hackathons\\bot', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(canonicalProjects, 'hackathons', 'bot')));
      expect(result.type).toBe('project');
      expect(result.project?.name).toBe('bot');
    });

    it('resolves unique standalone name across groups (bot)', async () => {
      const result = await resolveProject('bot', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(canonicalProjects, 'hackathons', 'bot')));
      expect(result.type).toBe('project');
      expect(result.project?.name).toBe('bot');
      expect(result.project?.group).toBe('hackathons');
      expect(result.isAmbiguous).toBe(false);
    });

    it('resolves standalone root project name (root-tool)', async () => {
      const result = await resolveProject('root-tool', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(canonicalProjects, 'root-tool')));
      expect(result.type).toBe('project');
      expect(result.project?.name).toBe('root-tool');
      expect(result.project?.group).toBeUndefined();
      expect(result.isAmbiguous).toBe(false);
    });

    it('resolves group folder directory name (hackathons)', async () => {
      const result = await resolveProject('hackathons', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(canonicalProjects, 'hackathons')));
      expect(result.type).toBe('group');
      expect(result.group?.name).toBe('hackathons');
      expect(result.isAmbiguous).toBe(false);
    });

    it('resolves empty group directory name (empty-group)', async () => {
      const result = await resolveProject('empty-group', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(canonicalProjects, 'empty-group')));
      expect(result.type).toBe('group');
      expect(result.group?.name).toBe('empty-group');
      expect(result.group?.projectCount).toBe(0);
    });

    it('resolves throwaway scratchpad by name (scratch-test)', async () => {
      const result = await resolveProject('scratch-test', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(throwawaysDir, 'scratch-test')));
      expect(result.type).toBe('throwaway');
      expect(result.project?.name).toBe('scratch-test');
      expect(result.project?.isThrowaway).toBe(true);
    });

    it('flags multi-match collisions when standalone name exists in multiple groups or root', async () => {
      const result = await resolveProject('duplicate-name', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(false);
      expect(result.targetPath).toBeNull();
      expect(result.isAmbiguous).toBe(true);
      expect(result.ambiguousMatches).toHaveLength(3);

      const matchPaths = result.ambiguousMatches.map((m) => m.path).sort();
      expect(matchPaths).toEqual([
        path.resolve(path.join(canonicalProjects, 'ai-tools', 'duplicate-name')),
        path.resolve(path.join(canonicalProjects, 'duplicate-name')),
        path.resolve(path.join(canonicalProjects, 'hackathons', 'duplicate-name')),
      ]);
    });

    it('resolves duplicate name when group path is specified explicitly', async () => {
      const result = await resolveProject('ai-tools/duplicate-name', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(path.resolve(path.join(canonicalProjects, 'ai-tools', 'duplicate-name')));
      expect(result.project?.group).toBe('ai-tools');
      expect(result.isAmbiguous).toBe(false);
    });

    it('returns not resolved when name does not exist', async () => {
      const result = await resolveProject('non-existent-proj', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(false);
      expect(result.targetPath).toBeNull();
      expect(result.isAmbiguous).toBe(false);
      expect(result.ambiguousMatches).toEqual([]);
    });

    it('returns not resolved for empty or whitespace query', async () => {
      const result = await resolveProject('   ', canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(false);
      expect(result.targetPath).toBeNull();
      expect(result.isAmbiguous).toBe(false);
    });

    it('resolves absolute path directly', async () => {
      const absoluteTarget = path.resolve(path.join(canonicalProjects, 'hackathons', 'bot'));
      const result = await resolveProject(absoluteTarget, canonicalProjects, {
        throwawaysRoot: throwawaysDir,
      });

      expect(result.resolved).toBe(true);
      expect(result.targetPath).toBe(absoluteTarget);
      expect(result.type).toBe('project');
      expect(result.project?.name).toBe('bot');
    });
  });
});
