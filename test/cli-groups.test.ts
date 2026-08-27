import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../src/index.js';
import { updateConfig } from '../src/config/index.js';
import { readIpcToken } from '../src/ipc/index.js';

describe('proj CLI Subfolder Groups & Navigation (cli-groups)', () => {
  let tempDir: string;
  let projectsDir: string;
  let throwawaysDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-cli-groups-'));
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

  describe('proj new <group>/<project>', () => {
    it('creates and commits a new project in projects/<group>/<project>', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'new', 'hackathons/agent-bot', '-t', 'typescript']);
        expect(output).toContain('Successfully created project "agent-bot"');
        const targetPath = path.join(projectsDir, 'hackathons', 'agent-bot');
        expect(fs.existsSync(targetPath)).toBe(true);
        expect(fs.existsSync(path.join(targetPath, 'package.json'))).toBe(true);
        expect(fs.existsSync(path.join(targetPath, 'AGENTS.md'))).toBe(true);
        expect(fs.existsSync(path.join(targetPath, '.git'))).toBe(true);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('creates project inside group when -g/--group flag is supplied', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'new', 'mcp-server', '--group', 'web-mcp']);
        expect(output).toContain('Successfully created project "mcp-server"');
        const targetPath = path.join(projectsDir, 'web-mcp', 'mcp-server');
        expect(fs.existsSync(targetPath)).toBe(true);
        expect(fs.existsSync(path.join(targetPath, 'AGENTS.md'))).toBe(true);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('handles invalid group name gracefully with error message', async () => {
      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'new', 'throwaways/invalid-nesting']);
        expect(errOutput).toContain('reserved directory name');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });
  });

  describe('proj cd & proj code auto-resolution', () => {
    beforeEach(() => {
      // Set up workspace structure:
      // projects/
      //   root-tool/
      //   duplicate-name/
      //   hackathons/
      //     agent-bot/
      //     duplicate-name/
      //   web-mcp/
      //     mcp-server/
      //   empty-group/
      // throwaways/
      //   quick-scratch/

      const rootTool = path.join(projectsDir, 'root-tool');
      const rootDup = path.join(projectsDir, 'duplicate-name');
      const hackBot = path.join(projectsDir, 'hackathons', 'agent-bot');
      const hackDup = path.join(projectsDir, 'hackathons', 'duplicate-name');
      const webServer = path.join(projectsDir, 'web-mcp', 'mcp-server');
      const emptyGroup = path.join(projectsDir, 'empty-group');
      const scratch = path.join(throwawaysDir, 'quick-scratch');

      fs.mkdirSync(rootTool, { recursive: true });
      fs.mkdirSync(rootDup, { recursive: true });
      fs.mkdirSync(hackBot, { recursive: true });
      fs.mkdirSync(hackDup, { recursive: true });
      fs.mkdirSync(webServer, { recursive: true });
      fs.mkdirSync(emptyGroup, { recursive: true });
      fs.mkdirSync(scratch, { recursive: true });

      fs.writeFileSync(path.join(rootTool, 'package.json'), '{}');
      fs.writeFileSync(path.join(rootDup, 'package.json'), '{}');
      fs.writeFileSync(path.join(hackBot, 'package.json'), '{}');
      fs.writeFileSync(path.join(hackDup, 'package.json'), '{}');
      fs.writeFileSync(path.join(webServer, 'package.json'), '{}');
    });

    it('auto-resolves unique grouped project via proj cd <name>', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'cd', 'agent-bot']);
        const target = path.resolve(path.join(projectsDir, 'hackathons', 'agent-bot'));
        expect(output).toContain('Jumping to project "agent-bot"');
        const token = readIpcToken({ configDir: tempDir });
        expect(token?.action).toBe('cd');
        expect(token?.targetPath).toBe(target);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('navigates directly to group directory via proj cd <group>', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'cd', 'hackathons']);
        const target = path.resolve(path.join(projectsDir, 'hackathons'));
        expect(output).toContain('Jumping to project "hackathons"');
        const token = readIpcToken({ configDir: tempDir });
        expect(token?.action).toBe('cd');
        expect(token?.targetPath).toBe(target);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('navigates directly to empty group directory via proj cd <empty-group>', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'cd', 'empty-group']);
        const target = path.resolve(path.join(projectsDir, 'empty-group'));
        expect(output).toContain('Jumping to project "empty-group"');
        const token = readIpcToken({ configDir: tempDir });
        expect(token?.action).toBe('cd');
        expect(token?.targetPath).toBe(target);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('navigates using exact group-qualified path via proj cd <group>/<project>', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'cd', 'hackathons/duplicate-name']);
        const target = path.resolve(path.join(projectsDir, 'hackathons', 'duplicate-name'));
        expect(output).toContain('Jumping to project "hackathons/duplicate-name"');
        const token = readIpcToken({ configDir: tempDir });
        expect(token?.action).toBe('cd');
        expect(token?.targetPath).toBe(target);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('prints clear error diagnostics if ambiguous duplicate names are detected for proj cd', async () => {
      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'cd', 'duplicate-name']);
        expect(errOutput).toContain('Ambiguous project name "duplicate-name"');
        expect(errOutput).toContain('hackathons/duplicate-name');
        expect(errOutput).toContain('duplicate-name');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });

    it('auto-resolves unique grouped project via proj code <name>', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'code', 'mcp-server']);
        const target = path.resolve(path.join(projectsDir, 'web-mcp', 'mcp-server'));
        expect(output).toContain('Opening project "mcp-server" in VS Code');
        const token = readIpcToken({ configDir: tempDir });
        expect(token?.action).toBe('code');
        expect(token?.targetPath).toBe(target);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('opens group directory in VS Code via proj code <group>', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'code', 'web-mcp']);
        const target = path.resolve(path.join(projectsDir, 'web-mcp'));
        expect(output).toContain('Opening project "web-mcp" in VS Code');
        const token = readIpcToken({ configDir: tempDir });
        expect(token?.action).toBe('code');
        expect(token?.targetPath).toBe(target);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('prints clear error diagnostics if ambiguous duplicate names are detected for proj code', async () => {
      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'code', 'duplicate-name']);
        expect(errOutput).toContain('Ambiguous project name "duplicate-name"');
        expect(errOutput).toContain('hackathons/duplicate-name');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });
  });

  describe('proj list & proj list --json with group sections', () => {
    beforeEach(() => {
      // 1. Root project
      const rootApp = path.join(projectsDir, 'root-app');
      fs.mkdirSync(rootApp, { recursive: true });
      fs.writeFileSync(path.join(rootApp, 'package.json'), '{}');

      // 2. Hackathons group
      const hackApp = path.join(projectsDir, 'hackathons', 'ai-bot');
      fs.mkdirSync(hackApp, { recursive: true });
      fs.writeFileSync(path.join(hackApp, 'pyproject.toml'), '');

      // 3. Web-MCP group
      const mcpApp = path.join(projectsDir, 'web-mcp', 'mcp-tool');
      fs.mkdirSync(mcpApp, { recursive: true });
      fs.writeFileSync(path.join(mcpApp, 'tsconfig.json'), '{}');

      // 4. Throwaway scratchpad
      const scratchApp = path.join(throwawaysDir, 'spike-db');
      fs.mkdirSync(scratchApp, { recursive: true });
    });

    it('displays projects organized by group section headers ([hackathons], [web-mcp], [root])', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'list']);
        expect(output).toContain('[hackathons]');
        expect(output).toContain('ai-bot');
        expect(output).toContain('[python]');

        expect(output).toContain('[web-mcp]');
        expect(output).toContain('mcp-tool');
        expect(output).toContain('[typescript]');

        expect(output).toContain('[root]');
        expect(output).toContain('root-app');

        expect(output).toContain('[throwaways]');
        expect(output).toContain('spike-db (throwaway)');
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('outputs project objects with group field via proj list --json', async () => {
      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'list', '--json']);
        const parsed = JSON.parse(output.trim());
        expect(Array.isArray(parsed)).toBe(true);

        const aiBot = parsed.find((p: any) => p.name === 'ai-bot');
        expect(aiBot).toBeDefined();
        expect(aiBot.group).toBe('hackathons');

        const mcpTool = parsed.find((p: any) => p.name === 'mcp-tool');
        expect(mcpTool).toBeDefined();
        expect(mcpTool.group).toBe('web-mcp');

        const rootApp = parsed.find((p: any) => p.name === 'root-app');
        expect(rootApp).toBeDefined();
        expect(rootApp.group).toBeUndefined();
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });

  describe('proj move <project> <target-group>', () => {
    it('relocates project from root to target group', async () => {
      const rootProj = path.join(projectsDir, 'standalone-tool');
      fs.mkdirSync(rootProj, { recursive: true });
      fs.writeFileSync(path.join(rootProj, 'package.json'), '{}');

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'move', 'standalone-tool', 'utilities']);
        expect(output).toContain('Successfully moved project "standalone-tool" to group "utilities"');
        expect(fs.existsSync(path.join(projectsDir, 'utilities', 'standalone-tool', 'package.json'))).toBe(true);
        expect(fs.existsSync(rootProj)).toBe(false);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('relocates project from one group to another and auto-prunes empty source group', async () => {
      const sourceProj = path.join(projectsDir, 'old-group', 'migrating-app');
      fs.mkdirSync(sourceProj, { recursive: true });
      fs.writeFileSync(path.join(sourceProj, 'package.json'), '{}');

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'move', 'migrating-app', 'new-group']);
        expect(output).toContain('Successfully moved project "migrating-app" to group "new-group"');
        expect(fs.existsSync(path.join(projectsDir, 'new-group', 'migrating-app'))).toBe(true);
        expect(fs.existsSync(path.join(projectsDir, 'old-group'))).toBe(false);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('relocates project from group to root workspace when target is "root"', async () => {
      const sourceProj = path.join(projectsDir, 'temp-group', 'promoted-tool');
      fs.mkdirSync(sourceProj, { recursive: true });
      fs.writeFileSync(path.join(sourceProj, 'package.json'), '{}');

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'move', 'promoted-tool', 'root']);
        expect(output).toContain('Successfully moved project "promoted-tool" to root workspace');
        expect(fs.existsSync(path.join(projectsDir, 'promoted-tool'))).toBe(true);
        expect(fs.existsSync(path.join(projectsDir, 'temp-group'))).toBe(false);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('supports mv alias command', async () => {
      const sourceProj = path.join(projectsDir, 'alias-proj');
      fs.mkdirSync(sourceProj, { recursive: true });
      fs.writeFileSync(path.join(sourceProj, 'package.json'), '{}');

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'mv', 'alias-proj', 'my-group']);
        expect(output).toContain('Successfully moved project "alias-proj" to group "my-group"');
        expect(fs.existsSync(path.join(projectsDir, 'my-group', 'alias-proj'))).toBe(true);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('handles move error when project is not found', async () => {
      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'move', 'non-existent-proj', 'some-group']);
        expect(errOutput).toContain('Cannot locate project "non-existent-proj"');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });

    it('handles move error when destination already exists', async () => {
      const sourceProj = path.join(projectsDir, 'group-a', 'collision-proj');
      const targetProj = path.join(projectsDir, 'target-group', 'collision-proj');
      fs.mkdirSync(sourceProj, { recursive: true });
      fs.mkdirSync(targetProj, { recursive: true });
      fs.writeFileSync(path.join(sourceProj, 'package.json'), '{}');
      fs.writeFileSync(path.join(targetProj, 'package.json'), '{}');

      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'move', 'group-a/collision-proj', 'target-group']);
        expect(errOutput).toContain('Destination path already exists');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });
  });
});
