import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  emitIpcToken,
  readIpcToken,
  clearIpcToken,
  consumeIpcToken,
  generatePowerShellWrapper,
  writePowerShellWrapper,
  generateCmdWrapper,
  writeCmdWrapper,
  type IpcPayload,
  type IpcAction,
  type CmdWrapperOptions,
} from '../src/ipc/index.js';
import { getIpcFile } from '../src/config/paths.js';

describe('PowerShell IPC Bridge', () => {
  let tempDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-ipc-'));
    process.env.PROJ_CONFIG_DIR = tempDir;
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

  describe('emitIpcToken()', () => {
    it('emits a cd action token with targetPath and timestamp to ipc.json', () => {
      const targetDir = path.join(tempDir, 'target-project');
      const now = Date.now();

      const payload = emitIpcToken('cd', targetDir);

      expect(payload.action).toBe('cd');
      expect(payload.targetPath).toBe(path.resolve(targetDir));
      expect(payload.timestamp).toBeGreaterThanOrEqual(now);

      const ipcFilePath = getIpcFile(tempDir);
      expect(fs.existsSync(ipcFilePath)).toBe(true);

      const fileContent = JSON.parse(fs.readFileSync(ipcFilePath, 'utf8')) as IpcPayload;
      expect(fileContent.action).toBe('cd');
      expect(fileContent.targetPath).toBe(path.resolve(targetDir));
      expect(fileContent.timestamp).toBe(payload.timestamp);
    });

    it('emits a code action token to open VS Code at targetPath', () => {
      const targetDir = path.join(tempDir, 'code-project');

      const payload = emitIpcToken('code', targetDir);

      expect(payload.action).toBe('code');
      expect(payload.targetPath).toBe(path.resolve(targetDir));

      const ipcFilePath = getIpcFile(tempDir);
      const fileContent = JSON.parse(fs.readFileSync(ipcFilePath, 'utf8')) as IpcPayload;
      expect(fileContent.action).toBe('code');
      expect(fileContent.targetPath).toBe(path.resolve(targetDir));
    });

    it('emits a none action token', () => {
      const targetDir = path.join(tempDir, 'no-nav');

      const payload = emitIpcToken('none', targetDir);

      expect(payload.action).toBe('none');
      expect(payload.targetPath).toBe(path.resolve(targetDir));

      const ipcFilePath = getIpcFile(tempDir);
      const fileContent = JSON.parse(fs.readFileSync(ipcFilePath, 'utf8')) as IpcPayload;
      expect(fileContent.action).toBe('none');
    });

    it('creates config directory automatically if it does not exist', () => {
      const nonExistentDir = path.join(tempDir, 'nested', 'config', 'dir');
      const targetDir = path.join(tempDir, 'project');

      expect(fs.existsSync(nonExistentDir)).toBe(false);

      const payload = emitIpcToken('cd', targetDir, { configDir: nonExistentDir });

      expect(fs.existsSync(nonExistentDir)).toBe(true);
      const ipcFilePath = getIpcFile(nonExistentDir);
      expect(fs.existsSync(ipcFilePath)).toBe(true);
      const fileContent = JSON.parse(fs.readFileSync(ipcFilePath, 'utf8')) as IpcPayload;
      expect(fileContent.action).toBe('cd');
    });

    it('atomically overwrites any existing ipc.json token', () => {
      const target1 = path.join(tempDir, 'proj1');
      const target2 = path.join(tempDir, 'proj2');

      emitIpcToken('cd', target1);
      const payload2 = emitIpcToken('code', target2);

      const ipcFilePath = getIpcFile(tempDir);
      const fileContent = JSON.parse(fs.readFileSync(ipcFilePath, 'utf8')) as IpcPayload;

      expect(fileContent.action).toBe('code');
      expect(fileContent.targetPath).toBe(path.resolve(target2));
      expect(fileContent.timestamp).toBe(payload2.timestamp);
    });

    it('throws an error if an invalid action is provided', () => {
      expect(() => {
        emitIpcToken('invalid-action' as unknown as IpcAction, tempDir);
      }).toThrow(/Invalid IPC action/i);
    });

    it('handles empty or relative target paths by resolving them', () => {
      const payload = emitIpcToken('cd', '.');
      expect(payload.targetPath).toBe(path.resolve('.'));
    });
  });

  describe('readIpcToken(), clearIpcToken(), consumeIpcToken()', () => {
    it('readIpcToken returns null if ipc.json does not exist', () => {
      const token = readIpcToken();
      expect(token).toBeNull();
    });

    it('readIpcToken reads existing token without deleting it', () => {
      const targetDir = path.join(tempDir, 'project-a');
      emitIpcToken('cd', targetDir);

      const token1 = readIpcToken();
      expect(token1).not.toBeNull();
      expect(token1?.action).toBe('cd');
      expect(token1?.targetPath).toBe(path.resolve(targetDir));

      const token2 = readIpcToken();
      expect(token2).toEqual(token1);
      expect(fs.existsSync(getIpcFile(tempDir))).toBe(true);
    });

    it('readIpcToken returns null and does not throw if ipc.json contains corrupted JSON', () => {
      const ipcFilePath = getIpcFile(tempDir);
      fs.writeFileSync(ipcFilePath, '{ broken json content [', 'utf8');

      const token = readIpcToken();
      expect(token).toBeNull();
    });

    it('clearIpcToken removes ipc.json safely and does not throw if file does not exist', () => {
      expect(() => clearIpcToken()).not.toThrow();

      emitIpcToken('cd', tempDir);
      expect(fs.existsSync(getIpcFile(tempDir))).toBe(true);

      clearIpcToken();
      expect(fs.existsSync(getIpcFile(tempDir))).toBe(false);

      // Calling again when file is gone should still not throw
      expect(() => clearIpcToken()).not.toThrow();
    });

    it('consumeIpcToken reads the token and deletes ipc.json atomically', () => {
      const targetDir = path.join(tempDir, 'project-consume');
      emitIpcToken('code', targetDir);

      const token = consumeIpcToken();
      expect(token).not.toBeNull();
      expect(token?.action).toBe('code');
      expect(token?.targetPath).toBe(path.resolve(targetDir));

      // After consumption, file is deleted and next consume returns null
      expect(fs.existsSync(getIpcFile(tempDir))).toBe(false);
      const nextToken = consumeIpcToken();
      expect(nextToken).toBeNull();
    });
  });

  describe('PowerShell Wrapper Generation', () => {
    it('generatePowerShellWrapper produces valid PowerShell function', () => {
      const script = generatePowerShellWrapper();

      expect(script).toContain('function proj {');
      expect(script).toContain('& $bin $args');
      expect(script).toContain('$LASTEXITCODE');
      expect(script).toContain('ipc.json');
      expect(script).toContain('ConvertFrom-Json');
      expect(script).toContain('Set-Location');
      expect(script).toContain('if ($?)');
      expect(script).toContain('Clear-Host');
      expect(script).toContain('code');
      expect(script).toContain('Remove-Item');
    });

    it('generatePowerShellWrapper checks $? before calling Clear-Host', () => {
      const script = generatePowerShellWrapper();
      expect(script).toMatch(/if \(\$\?\) \{\s+Clear-Host\s+\}/);
    });

    it('supports custom function and binary names in generatePowerShellWrapper', () => {
      const script = generatePowerShellWrapper({
        functionName: 'myproj',
        binName: 'myproj-bin',
      });

      expect(script).toContain('function myproj {');
      expect(script).toContain('$bin = "myproj-bin"');
    });

    it('supports custom config directory in generatePowerShellWrapper', () => {
      const customConfigDir = 'C:\\Custom\\.proj';
      const script = generatePowerShellWrapper({
        configDir: customConfigDir,
      });

      expect(script).toContain('C:\\Custom\\.proj');
    });

    it('writePowerShellWrapper writes the script to disk', () => {
      const targetScriptPath = path.join(tempDir, 'proj.ps1');
      const writtenPath = writePowerShellWrapper(targetScriptPath);

      expect(writtenPath).toBe(targetScriptPath);
      expect(fs.existsSync(targetScriptPath)).toBe(true);

      const content = fs.readFileSync(targetScriptPath, 'utf8');
      expect(content).toContain('function proj {');
    });

    it('writePowerShellWrapper defaults to ~/.proj/proj.ps1 (or configDir/proj.ps1)', () => {
      const writtenPath = writePowerShellWrapper();

      expect(writtenPath).toBe(path.join(tempDir, 'proj.ps1'));
      expect(fs.existsSync(writtenPath)).toBe(true);
    });
  });

  describe('CMD Wrapper Generation', () => {
    it('generateCmdWrapper produces valid CMD batch wrapper script', () => {
      const script = generateCmdWrapper();

      expect(script).toContain('@ECHO off');
      expect(script).toContain('SETLOCAL EnableDelayedExpansion');
      expect(script).toContain('ipc.json');
      expect(script).toContain('cd /d');
      expect(script).toContain('if not errorlevel 1 if "!IPC_ACTION!"=="cd" cls');
      expect(script).toContain('DEL "%IPC_FILE%"');
      expect(script).toContain('exit /b %PROJ_EXIT%');
    });

    it('generateCmdWrapper supports isNpmShim option', () => {
      const script = generateCmdWrapper({ isNpmShim: true });

      expect(script).toContain('"%_prog%"');
      expect(script).toContain('node_modules\\proj-cli\\dist\\index.js');
      expect(script).toContain('cd /d');
      expect(script).toContain('if not errorlevel 1 if "!IPC_ACTION!"=="cd" cls');
      expect(script).toContain('DEL "%IPC_FILE%"');
    });

    it('generateCmdWrapper only clears host if cd /d succeeded and action was cd', () => {
      const script = generateCmdWrapper();
      expect(script).toMatch(/cd \/d "%%T"\r?\n\s+if not errorlevel 1 if "!IPC_ACTION!"=="cd" cls/);
    });

    it('generateCmdWrapper supports custom binary name and config directory', () => {
      const customConfigDir = 'C:\\Custom\\.proj';
      const script = generateCmdWrapper({
        binName: 'myproj',
        configDir: customConfigDir,
      });

      expect(script).toContain('C:\\Custom\\.proj\\ipc.json');
      expect(script).toContain('call myproj %*');
    });

    it('generateCmdWrapper supports custom targetJs path', () => {
      const script = generateCmdWrapper({
        targetJs: 'C:\\custom\\dist\\index.js',
      });

      expect(script).toContain('node "C:\\custom\\dist\\index.js" %*');
    });

    it('writeCmdWrapper writes the script to disk', () => {
      const targetScriptPath = path.join(tempDir, 'proj.cmd');
      const writtenPath = writeCmdWrapper(targetScriptPath);

      expect(writtenPath).toBe(targetScriptPath);
      expect(fs.existsSync(targetScriptPath)).toBe(true);

      const content = fs.readFileSync(targetScriptPath, 'utf8');
      expect(content).toContain('cd /d');
      expect(content).toContain('ipc.json');
    });

    it('writeCmdWrapper defaults to ~/.proj/proj.cmd (or configDir/proj.cmd)', () => {
      const writtenPath = writeCmdWrapper();

      expect(writtenPath).toBe(path.join(tempDir, 'proj.cmd'));
      expect(fs.existsSync(writtenPath)).toBe(true);
    });
  });

  describe('Concurrent operations', () => {
    it('handles multiple rapid emissions and reads gracefully', async () => {
      const iterations = 50;
      for (let i = 0; i < iterations; i++) {
        const p = path.join(tempDir, `dir-${i}`);
        emitIpcToken(i % 2 === 0 ? 'cd' : 'code', p);
        const token = readIpcToken();
        expect(token).not.toBeNull();
        expect(token?.targetPath).toBe(path.resolve(p));
      }
    });
  });
});
