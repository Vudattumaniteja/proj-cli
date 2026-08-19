import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../src/index.js';
import { updateConfig } from '../src/config/index.js';

describe('proj CLI basic interface', () => {
  let tempDir: string;
  let projectsDir: string;
  let throwawaysDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-cli-'));
    process.env.PROJ_CONFIG_DIR = tempDir;
    projectsDir = path.join(tempDir, 'projects');
    throwawaysDir = path.join(projectsDir, 'throwaways');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(throwawaysDir, { recursive: true });

    updateConfig({
      projectsRoot: projectsDir,
      throwawaysRoot: throwawaysDir,
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

  it('configures program name, version, and description correctly', () => {
    const program = createProgram();
    expect(program.name()).toBe('proj');
    expect(program.version()).toBe('0.1.0');
    expect(program.description()).toContain('TypeScript CLI for Developer Workspace & Local Git Project Management');
  });

  it('outputs version string when --version flag is passed', () => {
    const program = createProgram();
    program.exitOverride();

    let output = '';
    program.configureOutput({
      writeOut: (str) => {
        output += str;
      },
    });

    expect(() => {
      program.parse(['node', 'proj', '--version']);
    }).toThrow();

    expect(output.trim()).toBe('0.1.0');
  });

  it('outputs help text when --help flag is passed', () => {
    const program = createProgram();
    program.exitOverride();

    let output = '';
    program.configureOutput({
      writeOut: (str) => {
        output += str;
      },
    });

    expect(() => {
      program.parse(['node', 'proj', '--help']);
    }).toThrow();

    expect(output).toContain('Usage: proj [options]');
    expect(output).toContain('TypeScript CLI for Developer Workspace & Local Git Project Management');
    expect(output).toContain('list|ls [options]');
  });

  it('runs list command and prints empty project message when workspace is empty', async () => {
    const program = createProgram();
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk.toString();
      return true;
    }) as any;

    try {
      await program.parseAsync(['node', 'proj', 'list']);
      expect(output).toContain('No projects found.');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('runs list command and displays table of projects when projects exist', async () => {
    const testApp = path.join(projectsDir, 'my-cli-tool');
    fs.mkdirSync(testApp);
    fs.writeFileSync(path.join(testApp, 'package.json'), '{}');

    const program = createProgram();
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk.toString();
      return true;
    }) as any;

    try {
      await program.parseAsync(['node', 'proj', 'list']);
      expect(output).toContain('NAME');
      expect(output).toContain('my-cli-tool');
      expect(output).toContain('[node]');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('runs list --json and prints valid JSON array', async () => {
    const testApp = path.join(projectsDir, 'my-backend');
    fs.mkdirSync(testApp);
    fs.writeFileSync(path.join(testApp, 'tsconfig.json'), '{}');

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
      expect(parsed[0].name).toBe('my-backend');
      expect(parsed[0].templateBadge).toBe('[typescript]');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('supports ls alias command', async () => {
    const testApp = path.join(projectsDir, 'alias-app');
    fs.mkdirSync(testApp);
    fs.writeFileSync(path.join(testApp, 'Cargo.toml'), '[package]');

    const program = createProgram();
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk.toString();
      return true;
    }) as any;

    try {
      await program.parseAsync(['node', 'proj', 'ls', '--json']);
      const parsed = JSON.parse(output.trim());
      expect(parsed[0].name).toBe('alias-app');
      expect(parsed[0].templateBadge).toBe('[rust]');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('runs new command and scaffolds a new project with Git commit and guardrails', async () => {
    const program = createProgram();
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk.toString();
      return true;
    }) as any;

    try {
      await program.parseAsync(['node', 'proj', 'new', 'cli-created-app', '-t', 'typescript']);
      expect(output).toContain('Successfully created project "cli-created-app"');
      expect(fs.existsSync(path.join(projectsDir, 'cli-created-app', 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'cli-created-app', 'AGENTS.md'))).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('runs create alias command and scaffolds a python project', async () => {
    const program = createProgram();
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk.toString();
      return true;
    }) as any;

    try {
      await program.parseAsync(['node', 'proj', 'create', 'py-cli-app', '--template', 'python']);
      expect(output).toContain('Successfully created project "py-cli-app"');
      expect(fs.existsSync(path.join(projectsDir, 'py-cli-app', 'pyproject.toml'))).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('handles error on duplicate project name gracefully', async () => {
    const program = createProgram();
    let errOutput = '';
    const originalErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk.toString();
      return true;
    }) as any;

    try {
      fs.mkdirSync(path.join(projectsDir, 'duplicate-cli-app'));
      await program.parseAsync(['node', 'proj', 'new', 'duplicate-cli-app']);
      expect(errOutput).toContain('already exists');
      expect(process.exitCode).toBe(1);
    } finally {
      process.stderr.write = originalErr;
      process.exitCode = 0;
    }
  });
});
