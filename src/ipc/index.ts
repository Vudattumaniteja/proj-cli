import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfigDir, getIpcFile } from '../config/paths.js';
import type { IpcAction, IpcPayload, IpcOptions, PowerShellWrapperOptions } from './types.js';

export * from './types.js';

const VALID_ACTIONS = new Set<IpcAction>(['cd', 'code', 'none']);

/**
 * Validates that an action string is a valid IpcAction.
 */
function isValidAction(action: unknown): action is IpcAction {
  return typeof action === 'string' && VALID_ACTIONS.has(action as IpcAction);
}

/**
 * Atomically writes data to a file by first writing to a temporary file and renaming it.
 */
function writeAtomicFileSync(targetFilePath: string, content: string): void {
  const targetDir = path.dirname(targetFilePath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const tmpFilePath = `${targetFilePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpFilePath, content, 'utf8');
    fs.renameSync(tmpFilePath, targetFilePath);
  } catch {
    // If atomic rename fails (e.g. cross-filesystem or OS restriction), fallback to direct write
    try {
      if (fs.existsSync(tmpFilePath)) {
        fs.unlinkSync(tmpFilePath);
      }
    } catch {
      // Ignore cleanup error
    }
    fs.writeFileSync(targetFilePath, content, 'utf8');
  }
}

/**
 * Emits an atomic IPC token payload to ~/.proj/ipc.json (or custom configDir/ipc.json).
 *
 * @param action - 'cd' | 'code' | 'none'
 * @param targetPath - Path to navigate to or open in editor
 * @param options - Configuration options such as custom configDir
 * @returns The emitted IpcPayload
 */
export function emitIpcToken(
  action: IpcAction,
  targetPath: string,
  options?: IpcOptions
): IpcPayload {
  if (!isValidAction(action)) {
    throw new Error(`Invalid IPC action: "${action}". Must be 'cd', 'code', or 'none'.`);
  }

  const resolvedPath = path.resolve(targetPath);
  const payload: IpcPayload = {
    action,
    targetPath: resolvedPath,
    timestamp: Date.now(),
  };

  const ipcFile = getIpcFile(options?.configDir);
  const serialized = JSON.stringify(payload, null, 2) + '\n';

  writeAtomicFileSync(ipcFile, serialized);
  return payload;
}

/**
 * Reads the current IPC token from disk without clearing it.
 * Returns null if file is missing or corrupted.
 */
export function readIpcToken(options?: IpcOptions): IpcPayload | null {
  const ipcFile = getIpcFile(options?.configDir);
  if (!fs.existsSync(ipcFile)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(ipcFile, 'utf8');
    const parsed = JSON.parse(raw);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      isValidAction(parsed.action) &&
      typeof parsed.targetPath === 'string' &&
      typeof parsed.timestamp === 'number'
    ) {
      return {
        action: parsed.action,
        targetPath: parsed.targetPath,
        timestamp: parsed.timestamp,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely removes the IPC file from disk.
 */
export function clearIpcToken(options?: IpcOptions): void {
  const ipcFile = getIpcFile(options?.configDir);
  try {
    if (fs.existsSync(ipcFile)) {
      fs.unlinkSync(ipcFile);
    }
  } catch {
    // Ignore deletion errors gracefully
  }
}

/**
 * Reads and consumes (clears) the IPC token.
 * Returns null if no token was available.
 */
export function consumeIpcToken(options?: IpcOptions): IpcPayload | null {
  const token = readIpcToken(options);
  if (token) {
    clearIpcToken(options);
  }
  return token;
}

/**
 * Generates the PowerShell wrapper function script (`proj.ps1`)
 * that intercepts IPC tokens emitted by the CLI and performs host shell navigation (cd / code).
 */
export function generatePowerShellWrapper(options?: PowerShellWrapperOptions): string {
  const fnName = options?.functionName || 'proj';
  const binName = options?.binName || 'proj';

  const configDirResolution = options?.configDir
    ? `"${options.configDir}"`
    : `$(if ($env:PROJ_CONFIG_DIR) { $env:PROJ_CONFIG_DIR } else { Join-Path $HOME ".proj" })`;

  return `# PowerShell Wrapper Function for proj CLI
function ${fnName} {
    $bin = "${binName}"
    & $bin $args
    $exitCode = $LASTEXITCODE

    $configDir = ${configDirResolution}
    $ipcFile = Join-Path $configDir "ipc.json"

    if (Test-Path $ipcFile) {
        try {
            $raw = Get-Content -Raw -Path $ipcFile -ErrorAction SilentlyContinue
            if ($raw) {
                $token = $raw | ConvertFrom-Json
                Remove-Item -Path $ipcFile -Force -ErrorAction SilentlyContinue

                if ($token -and $token.action -and $token.targetPath) {
                    if ($token.action -eq "cd") {
                        if (Test-Path $token.targetPath) {
                            Set-Location -Path $token.targetPath
                        }
                    } elseif ($token.action -eq "code") {
                        if (Test-Path $token.targetPath) {
                            Set-Location -Path $token.targetPath
                        }
                        code $token.targetPath
                    }
                }
            }
        } catch {
            # Gracefully handle any IPC parsing or path errors
        }
    }

    return $exitCode
}
`;
}

/**
 * Writes the PowerShell wrapper script to disk.
 * Defaults to `~/.proj/proj.ps1` (or custom configDir).
 *
 * @param outputPath - Optional explicit destination path
 * @param options - PowerShell wrapper configuration options
 * @returns The destination file path
 */
export function writePowerShellWrapper(
  outputPath?: string,
  options?: PowerShellWrapperOptions
): string {
  const destPath =
    outputPath || path.join(getConfigDir(options?.configDir), 'proj.ps1');

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const scriptContent = generatePowerShellWrapper(options);
  fs.writeFileSync(destPath, scriptContent, 'utf8');

  return destPath;
}
