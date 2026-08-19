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
  });

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
});
