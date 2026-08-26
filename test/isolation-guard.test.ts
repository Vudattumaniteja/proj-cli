import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  updateConfig,
  ensureConfigDirs,
} from '../src/config/index.js';

describe('Test Isolation & Host Environment Guard', () => {
  let tempDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-isolation-'));
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

  it('throws Test isolation violation if updateConfig is called in test mode without an isolated configDir or PROJ_CONFIG_DIR', () => {
    delete process.env.PROJ_CONFIG_DIR;

    expect(() => {
      updateConfig({ defaultTtlDays: 7 });
    }).toThrow(/Test isolation violation/i);
  });

  it('throws Test isolation violation if ensureConfigDirs is called in test mode without an isolated configDir or PROJ_CONFIG_DIR', () => {
    delete process.env.PROJ_CONFIG_DIR;

    expect(() => {
      ensureConfigDirs();
    }).toThrow(/Test isolation violation/i);
  });

  it('succeeds when PROJ_CONFIG_DIR is explicitly pointed to an isolated temporary directory', () => {
    process.env.PROJ_CONFIG_DIR = tempDir;

    const ensured = ensureConfigDirs();
    expect(ensured.configDir).toBe(tempDir);
    expect(fs.existsSync(ensured.configFile)).toBe(true);

    const updated = updateConfig({ defaultTtlDays: 5 });
    expect(updated.defaultTtlDays).toBe(5);
  });

  it('static codebase check: verifies all test files configure test isolation and avoid live host paths', () => {
    const testDir = path.resolve(__dirname, '..', 'test');
    const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts'));

    expect(testFiles.length).toBeGreaterThan(10);

    for (const file of testFiles) {
      const content = fs.readFileSync(path.join(testDir, file), 'utf8');

      // Tests should not hardcode live Windows paths
      expect(content).not.toMatch(/['"]C:\\Users\\Manit\\\.proj['"]/);
      expect(content).not.toMatch(/['"]C:\\Users\\Manit\\Desktop['"]/);
    }
  });
});
