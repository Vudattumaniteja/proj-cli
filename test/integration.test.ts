import { describe, it, expect, beforeAll } from 'vitest';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distIndex = path.resolve(rootDir, 'dist', 'index.js');

describe('proj CLI binary build and execution', () => {
  beforeAll(async () => {
    // Build the project using npm run build
    await execa('npm', ['run', 'build'], { cwd: rootDir });
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
  });

  it('executes dist/index.js with no args and prints help text', async () => {
    const { stdout } = await execa('node', [distIndex]);
    expect(stdout).toContain('Usage: proj [options]');
  });
});
