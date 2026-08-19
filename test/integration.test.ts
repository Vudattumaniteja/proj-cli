import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distIndex = path.resolve(rootDir, 'dist', 'index.js');

describe('proj CLI binary build and execution', () => {
  let tempConfigDir: string;
  let sampleProjectsDir: string;

  beforeAll(async () => {
    // Build the project using npm run build
    await execa('npm', ['run', 'build'], { cwd: rootDir });

    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-integ-'));
    sampleProjectsDir = path.join(tempConfigDir, 'projects');
    fs.mkdirSync(sampleProjectsDir, { recursive: true });

    // Pre-create dummy project
    const sampleApp = path.join(sampleProjectsDir, 'frontend-app');
    fs.mkdirSync(sampleApp);
    fs.writeFileSync(path.join(sampleApp, 'tsconfig.json'), '{}');

    // Create config.json
    fs.writeFileSync(
      path.join(tempConfigDir, 'config.json'),
      JSON.stringify({
        projectsRoot: sampleProjectsDir,
        throwawaysRoot: path.join(sampleProjectsDir, 'throwaways'),
      })
    );
  }, 30000);

  afterAll(() => {
    if (fs.existsSync(tempConfigDir)) {
      fs.rmSync(tempConfigDir, { recursive: true, force: true });
    }
  });

  it('generates dist/index.js bundle with shebang', () => {
    expect(fs.existsSync(distIndex)).toBe(true);
    const content = fs.readFileSync(distIndex, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('executes dist/index.js --version and prints 0.1.0', async () => {
    const { stdout } = await execa('node', [distIndex, '--version']);
    expect(stdout.trim()).toBe('0.1.0');
  });

  it('executes dist/index.js --help and prints help text', async () => {
    const { stdout } = await execa('node', [distIndex, '--help']);
    expect(stdout).toContain('Usage: proj [options]');
    expect(stdout).toContain('TypeScript CLI for Developer Workspace & Local Git Project Management');
    expect(stdout).toContain('list|ls [options]');
  });

  it('executes dist/index.js with no args and prints help text', async () => {
    const { stdout } = await execa('node', [distIndex]);
    expect(stdout).toContain('Usage: proj [options]');
  });

  it('executes dist/index.js list and outputs formatted table', async () => {
    const { stdout } = await execa('node', [distIndex, 'list'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    expect(stdout).toContain('NAME');
    expect(stdout).toContain('frontend-app');
    expect(stdout).toContain('[typescript]');
  });

  it('executes dist/index.js list --json and outputs structured JSON', async () => {
    const { stdout } = await execa('node', [distIndex, 'list', '--json'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    const parsed = JSON.parse(stdout.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe('frontend-app');
    expect(parsed[0].templateBadge).toBe('[typescript]');
  });

  it('executes dist/index.js new to scaffold project and discovers it via list', async () => {
    const { stdout: newOut } = await execa(
      'node',
      [distIndex, 'new', 'integ-web-app', '-t', 'web'],
      {
        env: { PROJ_CONFIG_DIR: tempConfigDir },
      }
    );
    expect(newOut).toContain('Successfully created project "integ-web-app"');
    expect(fs.existsSync(path.join(sampleProjectsDir, 'integ-web-app', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(sampleProjectsDir, 'integ-web-app', 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(sampleProjectsDir, 'integ-web-app', '.gitignore'))).toBe(true);

    const { stdout: listOut } = await execa('node', [distIndex, 'list', '--json'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    const parsed = JSON.parse(listOut.trim());
    const found = parsed.find((p: any) => p.name === 'integ-web-app');
    expect(found).toBeDefined();
    expect(found.templateBadge).toBe('[web]');
    expect(found.isGit).toBe(true);
    expect(found.isDirty).toBe(false);
  });

  it('executes dist/index.js scratch, extend, and graduate lifecycle via CLI binary', async () => {
    const throwawaysDir = path.join(sampleProjectsDir, 'throwaways');

    // 1. Create scratchpad
    const { stdout: scratchOut } = await execa(
      'node',
      [distIndex, 'scratch', 'binary-scratch-app', '--ttl', '3', '-t', 'typescript'],
      {
        env: { PROJ_CONFIG_DIR: tempConfigDir },
      }
    );
    expect(scratchOut).toContain('Successfully created throwaway scratchpad "binary-scratch-app"');
    expect(fs.existsSync(path.join(throwawaysDir, 'binary-scratch-app', 'package.json'))).toBe(true);

    // 2. Extend scratchpad
    const { stdout: extendOut } = await execa(
      'node',
      [distIndex, 'extend', 'binary-scratch-app', '5'],
      {
        env: { PROJ_CONFIG_DIR: tempConfigDir },
      }
    );
    expect(extendOut).toContain('Successfully extended throwaway "binary-scratch-app" by 5 days');

    // 3. Graduate scratchpad
    const { stdout: gradOut } = await execa(
      'node',
      [distIndex, 'graduate', 'binary-scratch-app'],
      {
        env: { PROJ_CONFIG_DIR: tempConfigDir },
      }
    );
    expect(gradOut).toContain('Successfully graduated throwaway "binary-scratch-app"');
    expect(fs.existsSync(path.join(sampleProjectsDir, 'binary-scratch-app', 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(throwawaysDir, 'binary-scratch-app'))).toBe(false);

    // 4. Verify discovery
    const { stdout: listOut } = await execa('node', [distIndex, 'list', '--json'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    const parsed = JSON.parse(listOut.trim());
    const found = parsed.find((p: any) => p.name === 'binary-scratch-app');
    expect(found).toBeDefined();
    expect(found.isThrowaway).toBe(false);
    expect(found.isGit).toBe(true);
  });

  it('executes dist/index.js checkpoint, checkpoints, and undo binary commands on a Git project', async () => {
    const projPath = path.join(sampleProjectsDir, 'binary-scratch-app');

    // 1. Checkpoint
    fs.writeFileSync(path.join(projPath, 'feature.txt'), 'checkpoint integ test', 'utf8');
    const { stdout: cpOut } = await execa(
      'node',
      [distIndex, 'checkpoint', 'milestone save via binary'],
      {
        cwd: projPath,
        env: { PROJ_CONFIG_DIR: tempConfigDir },
      }
    );
    expect(cpOut).toContain('Successfully created checkpoint');
    expect(cpOut).toContain('checkpoint: milestone save via binary');

    // 2. Checkpoints list
    const { stdout: listCpOut } = await execa(
      'node',
      [distIndex, 'checkpoints', '--json'],
      {
        cwd: projPath,
        env: { PROJ_CONFIG_DIR: tempConfigDir },
      }
    );
    const checkpoints = JSON.parse(listCpOut.trim());
    expect(Array.isArray(checkpoints)).toBe(true);
    expect(checkpoints[0].message).toBe('checkpoint: milestone save via binary');

    // 3. Undo with uncommitted changes
    fs.writeFileSync(path.join(projPath, 'scratch_work.txt'), 'in progress', 'utf8');
    const { stdout: undoOut } = await execa(
      'node',
      [distIndex, 'undo'],
      {
        cwd: projPath,
        env: { PROJ_CONFIG_DIR: tempConfigDir },
      }
    );
    expect(undoOut).toContain('Rolled back to checkpoint');
    expect(undoOut).toContain('Emergency safety stash created');
    expect(fs.existsSync(path.join(projPath, 'scratch_work.txt'))).toBe(false);
  });

  it('executes dist/index.js doctor and doctor --fix binary commands', async () => {
    // 1. Run doctor
    const { stdout: docOut } = await execa('node', [distIndex, 'doctor'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    expect(docOut).toContain('System Diagnostics');
    expect(docOut).toContain('Git binary availability');

    // 2. Run doctor --json
    const { stdout: docJsonOut } = await execa('node', [distIndex, 'doctor', '--json'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    const docReport = JSON.parse(docJsonOut.trim());
    expect(docReport.checks.length).toBe(5);

    // 3. Run doctor --fix
    const { stdout: docFixOut } = await execa('node', [distIndex, 'doctor', '--fix'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    expect(docFixOut).toContain('System Diagnostics & Self-Healing');
    expect(docFixOut).toContain('Post-repair Diagnostic Status');

    // 4. Run doctor --fix --json
    const { stdout: docFixJsonOut } = await execa('node', [distIndex, 'doctor', '--fix', '--json'], {
      env: { PROJ_CONFIG_DIR: tempConfigDir },
    });
    const fixReport = JSON.parse(docFixJsonOut.trim());
    expect(fixReport.fixedReport.allOk).toBe(true);
  });
});

