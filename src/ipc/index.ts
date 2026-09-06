import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfigDir, getIpcFile } from '../config/paths.js';
import type {
  IpcAction,
  IpcPayload,
  IpcOptions,
  PowerShellWrapperOptions,
  CmdWrapperOptions,
} from './types.js';

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

  return `# PowerShell Wrapper Function for ${fnName} CLI
function ${fnName} {
    $bin = (Get-Command -CommandType Application "${binName}.cmd" -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $bin) {
        $bin = (Get-Command -CommandType Application,ExternalScript "${binName}" -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*$HOME\\.proj\\*" } | Select-Object -First 1).Source
    }
    if (-not $bin) { $bin = "${binName}" }
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
                        if (Test-Path -LiteralPath $token.targetPath) {
                            if (Test-Path -PathType Container -LiteralPath $token.targetPath) {
                                Set-Location -LiteralPath $token.targetPath
                            } else {
                                Set-Location -LiteralPath (Split-Path -Parent $token.targetPath)
                            }
                            Clear-Host
                        }
                    } elseif ($token.action -eq "code") {
                        if (Test-Path -LiteralPath $token.targetPath) {
                            if (Test-Path -PathType Container -LiteralPath $token.targetPath) {
                                Set-Location -LiteralPath $token.targetPath
                            }
                        }
                        code "$($token.targetPath)"
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

/**
 * Generates the Windows CMD batch wrapper script (`proj.cmd`)
 * that runs the underlying CLI binary or script, inspects `ipc.json`,
 * performs host shell navigation (`cd /d`) and editor opening (`code`),
 * and cleans up the IPC token file.
 */
export function generateCmdWrapper(options?: CmdWrapperOptions): string {
  const binName = options?.binName || 'proj';
  const configDirResolution = options?.configDir
    ? `SET "IPC_FILE=${path.join(options.configDir, 'ipc.json')}"`
    : `SET "IPC_FILE=%USERPROFILE%\\.proj\\ipc.json"\nIF DEFINED PROJ_CONFIG_DIR (\n  SET "IPC_FILE=%PROJ_CONFIG_DIR%\\ipc.json"\n)`;

  if (options?.isNpmShim) {
    const targetPath = options.targetJs || '%dp0%\\node_modules\\proj-cli\\dist\\index.js';
    return `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL EnableDelayedExpansion
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

"%_prog%" "${targetPath}" %*
SET "PROJ_EXIT=!ERRORLEVEL!"

${configDirResolution}

SET "JUMP_TARGET="
SET "IPC_ACTION="
IF EXIST "%IPC_FILE%" (
  FOR /F "usebackq tokens=1* delims=;" %%A IN (\`%_prog% -e "try{var d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(d.targetPath)console.log(d.action+';'+d.targetPath);}catch(e){}" "%IPC_FILE%"\`) DO (
    SET "IPC_ACTION=%%A"
    SET "JUMP_TARGET=%%B"
  )
  DEL "%IPC_FILE%" 2>NUL
)

IF DEFINED JUMP_TARGET (
  IF "!IPC_ACTION!"=="code" (
    code "!JUMP_TARGET!" 2>NUL
  )
  FOR /F "tokens=1,2 delims=;" %%T IN ("!JUMP_TARGET!;!PROJ_EXIT!") DO (
    ENDLOCAL
    IF EXIST "%%T\\" (
      cd /d "%%T"
      cls
    )
    exit /b %%U
  )
)

ENDLOCAL & exit /b %PROJ_EXIT%
`;
  }

  const runCommand = options?.targetJs
    ? `node "${options.targetJs}" %*`
    : `call ${binName} %*`;

  return `@ECHO off
SETLOCAL EnableDelayedExpansion

${configDirResolution}

${runCommand}
SET "PROJ_EXIT=!ERRORLEVEL!"

SET "JUMP_TARGET="
SET "IPC_ACTION="
IF EXIST "%IPC_FILE%" (
  FOR /F "usebackq tokens=1* delims=;" %%A IN (\`node -e "try{var d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(d.targetPath)console.log(d.action+';'+d.targetPath);}catch(e){}" "%IPC_FILE%"\`) DO (
    SET "IPC_ACTION=%%A"
    SET "JUMP_TARGET=%%B"
  )
  DEL "%IPC_FILE%" 2>NUL
)

IF DEFINED JUMP_TARGET (
  IF "!IPC_ACTION!"=="code" (
    code "!JUMP_TARGET!" 2>NUL
  )
  FOR /F "tokens=1,2 delims=;" %%T IN ("!JUMP_TARGET!;!PROJ_EXIT!") DO (
    ENDLOCAL
    IF EXIST "%%T\\" (
      cd /d "%%T"
      cls
    )
    exit /b %%U
  )
)

ENDLOCAL & exit /b %PROJ_EXIT%
`;
}

/**
 * Writes the CMD batch wrapper script to disk.
 * Defaults to `~/.proj/proj.cmd` (or custom configDir).
 *
 * @param outputPath - Optional explicit destination path
 * @param options - CMD wrapper configuration options
 * @returns The destination file path
 */
export function writeCmdWrapper(
  outputPath?: string,
  options?: CmdWrapperOptions
): string {
  const destPath =
    outputPath || path.join(getConfigDir(options?.configDir), 'proj.cmd');

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const scriptContent = generateCmdWrapper(options);
  fs.writeFileSync(destPath, scriptContent, 'utf8');

  return destPath;
}
