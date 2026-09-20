import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  writeCmdWrapper,
  writePowerShellWrapper,
} from '../src/ipc/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distIndex = path.resolve(rootDir, 'dist', 'index.js');

function toCanonical(p: string): string {
  try {
    return fs.realpathSync.native(p).toLowerCase();
  } catch {
    return path.resolve(p).toLowerCase();
  }
}

describe.runIf(process.platform === 'win32')('Shell Wrappers Subprocess Execution (e2e)', () => {
  let tempDir: string;
  let configDir: string;
  let projectsDir: string;
  let sampleProjectDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeAll(async () => {
    // Ensure dist/index.js exists before executing wrapper subprocess tests
    if (!fs.existsSync(distIndex)) {
      await execa('npm', ['run', 'build'], { cwd: rootDir });
    }
  }, 30000);

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-e2e-wrappers-'));
    configDir = path.join(tempDir, '.proj');
    projectsDir = path.join(tempDir, 'projects');
    sampleProjectDir = path.join(projectsDir, 'sample-project');

    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(sampleProjectDir, { recursive: true });

    // Mark sample-project as a valid project for discovery
    fs.writeFileSync(
      path.join(sampleProjectDir, 'package.json'),
      JSON.stringify({ name: 'sample-project', version: '1.0.0' }, null, 2),
      'utf8'
    );

    // Create config.json pointing projectsRoot to projects/
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify(
        {
          projectsRoot: projectsDir,
          throwawaysRoot: path.join(projectsDir, 'throwaways'),
        },
        null,
        2
      ),
      'utf8'
    );

    process.env.PROJ_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (originalEnvConfigDir !== undefined) {
      process.env.PROJ_CONFIG_DIR = originalEnvConfigDir;
    } else {
      delete process.env.PROJ_CONFIG_DIR;
    }

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('CMD Wrapper (proj.cmd)', () => {
    it('successfully navigates host shell to sample-project and prints path on last line', async () => {
      const cmdWrapperPath = writeCmdWrapper(path.join(configDir, 'proj.cmd'), {
        targetJs: distIndex,
        configDir,
      });

      expect(fs.existsSync(cmdWrapperPath)).toBe(true);

      const command = `call "${cmdWrapperPath}" cd sample-project && cd`;
      const result = await execa('cmd.exe', ['/c', command], {
        cwd: tempDir,
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          PROJ_CONFIG_DIR: configDir,
        },
      });

      expect(result.exitCode).toBe(0);

      const lines = result.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastLine = lines[lines.length - 1];

      expect(toCanonical(lastLine)).toBe(toCanonical(sampleProjectDir));

      // IPC token should be consumed and deleted
      const ipcPath = path.join(configDir, 'ipc.json');
      expect(fs.existsSync(ipcPath)).toBe(false);
    });

    it('returns non-zero exit code and preserves current directory when navigating to non-existent project', async () => {
      const cmdWrapperPath = writeCmdWrapper(path.join(configDir, 'proj.cmd'), {
        targetJs: distIndex,
        configDir,
      });

      const command = `call "${cmdWrapperPath}" cd non-existent && cd`;
      const result = await execa('cmd.exe', ['/c', command], {
        cwd: tempDir,
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          PROJ_CONFIG_DIR: configDir,
        },
        reject: false,
      });

      expect(result.exitCode).not.toBe(0);

      // Verify directory was NOT changed by checking directory using || cd
      const dirCheck = await execa(
        'cmd.exe',
        ['/c', `call "${cmdWrapperPath}" cd non-existent || cd`],
        {
          cwd: tempDir,
          windowsVerbatimArguments: true,
          env: {
            ...process.env,
            PROJ_CONFIG_DIR: configDir,
          },
          reject: false,
        }
      );

      const lines = dirCheck.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastLine = lines[lines.length - 1];

      expect(toCanonical(lastLine)).toBe(toCanonical(tempDir));
    });
  });

  describe('NPM Shim CMD Wrapper (isNpmShim: true)', () => {
    it('successfully navigates host shell using npm shim variant', async () => {
      const cmdShimPath = writeCmdWrapper(path.join(configDir, 'proj-shim.cmd'), {
        isNpmShim: true,
        targetJs: distIndex,
        configDir,
      });

      expect(fs.existsSync(cmdShimPath)).toBe(true);

      const command = `call "${cmdShimPath}" cd sample-project && cd`;
      const result = await execa('cmd.exe', ['/c', command], {
        cwd: tempDir,
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          PROJ_CONFIG_DIR: configDir,
        },
      });

      expect(result.exitCode).toBe(0);

      const lines = result.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastLine = lines[lines.length - 1];

      expect(toCanonical(lastLine)).toBe(toCanonical(sampleProjectDir));
    });

    it('returns non-zero exit code and preserves current directory when navigating to non-existent project with npm shim', async () => {
      const cmdShimPath = writeCmdWrapper(path.join(configDir, 'proj-shim.cmd'), {
        isNpmShim: true,
        targetJs: distIndex,
        configDir,
      });

      const command = `call "${cmdShimPath}" cd non-existent && cd`;
      const result = await execa('cmd.exe', ['/c', command], {
        cwd: tempDir,
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          PROJ_CONFIG_DIR: configDir,
        },
        reject: false,
      });

      expect(result.exitCode).not.toBe(0);

      const dirCheck = await execa(
        'cmd.exe',
        ['/c', `call "${cmdShimPath}" cd non-existent || cd`],
        {
          cwd: tempDir,
          windowsVerbatimArguments: true,
          env: {
            ...process.env,
            PROJ_CONFIG_DIR: configDir,
          },
          reject: false,
        }
      );

      const lines = dirCheck.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastLine = lines[lines.length - 1];

      expect(toCanonical(lastLine)).toBe(toCanonical(tempDir));
    });
  });

  describe('PowerShell Wrapper (proj.ps1)', () => {
    it('successfully navigates host shell to sample-project and returns canonical path', async () => {
      // PowerShell wrapper calls proj.cmd under the hood
      writeCmdWrapper(path.join(configDir, 'proj.cmd'), {
        targetJs: distIndex,
        configDir,
      });

      const psWrapperPath = writePowerShellWrapper(path.join(configDir, 'proj.ps1'), {
        configDir,
      });

      expect(fs.existsSync(psWrapperPath)).toBe(true);

      const psCommand = `. '${psWrapperPath}'; proj cd sample-project; (Get-Location).Path`;
      const result = await execa(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
        {
          cwd: tempDir,
          env: {
            ...process.env,
            PROJ_CONFIG_DIR: configDir,
            PATH: `${configDir}${path.delimiter}${process.env.PATH || ''}`,
          },
        }
      );

      expect(result.exitCode).toBe(0);

      const lines = result.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastLine = lines[lines.length - 1];

      expect(toCanonical(lastLine)).toBe(toCanonical(sampleProjectDir));

      // IPC token should be consumed and deleted
      const ipcPath = path.join(configDir, 'ipc.json');
      expect(fs.existsSync(ipcPath)).toBe(false);
    });

    it('returns non-zero exit code and preserves current directory when navigating to non-existent project in PowerShell', async () => {
      writeCmdWrapper(path.join(configDir, 'proj.cmd'), {
        targetJs: distIndex,
        configDir,
      });

      const psWrapperPath = writePowerShellWrapper(path.join(configDir, 'proj.ps1'), {
        configDir,
      });

      const psCommand = `. '${psWrapperPath}'; proj cd non-existent; (Get-Location).Path; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
      const result = await execa(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
        {
          cwd: tempDir,
          env: {
            ...process.env,
            PROJ_CONFIG_DIR: configDir,
            PATH: `${configDir}${path.delimiter}${process.env.PATH || ''}`,
          },
          reject: false,
        }
      );

      expect(result.exitCode).not.toBe(0);

      const lines = result.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastLine = lines[lines.length - 1];

      expect(toCanonical(lastLine)).toBe(toCanonical(tempDir));
    });
  });
});
