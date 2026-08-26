import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execa, execaSync } from 'execa';
import pc from 'picocolors';
import {
  getConfig,
  getDefaultConfig,
  getConfigDir,
  getConfigFile,
  getTemplatesDir,
  ensureConfigDirs,
  DEFAULT_AGENTS_TEMPLATE_NAME,
  DEFAULT_GITIGNORE_TEMPLATE_NAME,
} from '../config/index.js';
import { writePowerShellWrapper, writeCmdWrapper } from '../ipc/index.js';

export const MIN_GIT_VERSION = '2.20.0';

export type DoctorCheckStatus = 'ok' | 'warning' | 'error';

export interface JunctionStatus {
  path: string;
  target: string;
  exists: boolean;
  isLink: boolean;
  valid: boolean;
  actualTarget: string | null;
  targetExists: boolean;
  message?: string;
}

export interface RepairJunctionResult {
  repaired: boolean;
  desktopJunctionPath: string;
  targetRoot: string;
  action: 'created' | 're-linked' | 'already-valid' | 'failed';
  error?: string;
}

export interface DoctorCheckResult {
  id: string;
  name: string;
  status: DoctorCheckStatus;
  message: string;
  details?: string;
  fixable: boolean;
  fixed?: boolean;
}

export interface DoctorReport {
  timestamp: string;
  allOk: boolean;
  passedCount: number;
  warningCount: number;
  errorCount: number;
  checks: DoctorCheckResult[];
}

export interface DoctorFixReport {
  timestamp: string;
  initialReport: DoctorReport;
  fixedReport: DoctorReport;
  fixedCount: number;
  unfixedCount: number;
  repairActions: string[];
}

export interface DoctorOptions {
  configDir?: string;
  projectsRoot?: string;
  throwawaysRoot?: string;
  desktopJunctionPath?: string;
  minGitVersion?: string;
  gitExec?: (args: string[]) => Promise<{ stdout: string }>;
}

/**
 * Compares two semantic version strings (e.g. "2.43.0" vs "2.20.0").
 * Returns 1 if v1 > v2, -1 if v1 < v2, and 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  const clean = (v: string) => v.replace(/^v/, '').trim();
  const parseParts = (v: string) =>
    clean(v)
      .split('.')
      .map((p) => {
        const num = parseInt(p, 10);
        return Number.isNaN(num) ? 0 : num;
      });

  const parts1 = parseParts(v1);
  const parts2 = parseParts(v2);
  const len = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Normalizes Windows and POSIX filesystem paths for robust comparison.
 */
function normalizePathForComparison(p: string): string {
  let normalized = path.resolve(p);
  if (normalized.startsWith('\\\\?\\')) {
    normalized = normalized.slice(4);
  }
  return process.platform === 'win32'
    ? path.normalize(normalized).toLowerCase()
    : path.normalize(normalized);
}

/**
 * Verifies the existence, link type, and destination target of the Desktop Directory Junction.
 *
 * @param desktopJunctionPath - Path to the desktop directory junction (e.g. ~/Desktop/Projects)
 * @param targetRoot - Path to the canonical projects root directory (e.g. ~/projects)
 */
export function verifyJunction(
  desktopJunctionPath: string,
  targetRoot: string
): JunctionStatus {
  const resolvedLink = path.resolve(desktopJunctionPath);
  const resolvedTarget = path.resolve(targetRoot);
  const targetExists = fs.existsSync(resolvedTarget);

  let lstatResult: fs.Stats | null = null;
  try {
    lstatResult = fs.lstatSync(resolvedLink);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return {
        path: resolvedLink,
        target: resolvedTarget,
        exists: false,
        isLink: false,
        valid: false,
        actualTarget: null,
        targetExists,
        message: 'Desktop Junction does not exist',
      };
    }
    return {
      path: resolvedLink,
      target: resolvedTarget,
      exists: false,
      isLink: false,
      valid: false,
      actualTarget: null,
      targetExists,
      message: `Error inspecting path: ${err.message}`,
    };
  }

  const isLink = lstatResult.isSymbolicLink();
  if (!isLink) {
    return {
      path: resolvedLink,
      target: resolvedTarget,
      exists: true,
      isLink: false,
      valid: false,
      actualTarget: null,
      targetExists,
      message: 'Target path exists but is a regular directory, not a junction',
    };
  }

  let rawTarget: string;
  try {
    rawTarget = fs.readlinkSync(resolvedLink);
  } catch (err: any) {
    return {
      path: resolvedLink,
      target: resolvedTarget,
      exists: true,
      isLink: true,
      valid: false,
      actualTarget: null,
      targetExists,
      message: `Failed to read link target: ${err.message}`,
    };
  }

  const resolvedActualTarget = path.resolve(path.dirname(resolvedLink), rawTarget);
  const actualTargetClean = resolvedActualTarget.startsWith('\\\\?\\')
    ? resolvedActualTarget.slice(4)
    : resolvedActualTarget;

  const matches =
    normalizePathForComparison(actualTargetClean) ===
    normalizePathForComparison(resolvedTarget);

  if (!matches) {
    return {
      path: resolvedLink,
      target: resolvedTarget,
      exists: true,
      isLink: true,
      valid: false,
      actualTarget: actualTargetClean,
      targetExists,
      message: `Desktop Junction points to "${actualTargetClean}", expected "${resolvedTarget}"`,
    };
  }

  if (!targetExists) {
    return {
      path: resolvedLink,
      target: resolvedTarget,
      exists: true,
      isLink: true,
      valid: false,
      actualTarget: actualTargetClean,
      targetExists: false,
      message: `Desktop Junction exists, but target directory does not exist: "${resolvedTarget}"`,
    };
  }

  return {
    path: resolvedLink,
    target: resolvedTarget,
    exists: true,
    isLink: true,
    valid: true,
    actualTarget: actualTargetClean,
    targetExists: true,
    message: 'Desktop Junction is valid and healthy',
  };
}

/**
 * Creates or repairs the Windows NTFS Directory Junction (or symlink) to point to the canonical projects root.
 *
 * @param desktopJunctionPath - Path where junction should be created (e.g. ~/Desktop/Projects)
 * @param targetRoot - Target canonical projects directory
 */
export function repairJunction(
  desktopJunctionPath: string,
  targetRoot: string
): RepairJunctionResult {
  const resolvedLink = path.resolve(desktopJunctionPath);
  const resolvedTarget = path.resolve(targetRoot);

  const initialStatus = verifyJunction(resolvedLink, resolvedTarget);
  if (initialStatus.valid && initialStatus.targetExists) {
    return {
      repaired: true,
      desktopJunctionPath: resolvedLink,
      targetRoot: resolvedTarget,
      action: 'already-valid',
    };
  }

  // 1. Ensure target directory exists
  if (!fs.existsSync(resolvedTarget)) {
    fs.mkdirSync(resolvedTarget, { recursive: true });
  }

  // 2. Ensure junction parent directory exists
  const parentDir = path.dirname(resolvedLink);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // 3. Remove existing link, empty directory, or file if present
  let wasLink = false;
  try {
    const stat = fs.lstatSync(resolvedLink);
    if (stat.isSymbolicLink()) {
      wasLink = true;
      try {
        fs.unlinkSync(resolvedLink);
      } catch {
        fs.rmdirSync(resolvedLink);
      }
    } else if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolvedLink);
      if (entries.length === 0) {
        fs.rmdirSync(resolvedLink);
      } else {
        return {
          repaired: false,
          desktopJunctionPath: resolvedLink,
          targetRoot: resolvedTarget,
          action: 'failed',
          error: `Cannot replace non-empty directory at "${resolvedLink}" with a junction`,
        };
      }
    } else {
      fs.unlinkSync(resolvedLink);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      return {
        repaired: false,
        desktopJunctionPath: resolvedLink,
        targetRoot: resolvedTarget,
        action: 'failed',
        error: `Failed to remove conflicting path: ${err.message}`,
      };
    }
  }

  // 4. Create NTFS Directory Junction (or directory symlink)
  const action = wasLink ? 're-linked' : 'created';
  try {
    fs.symlinkSync(resolvedTarget, resolvedLink, 'junction');
  } catch (symlinkErr: any) {
    // Windows fallback using mklink /J or PowerShell
    if (process.platform === 'win32') {
      try {
        execaSync('cmd.exe', ['/c', 'mklink', '/J', resolvedLink, resolvedTarget]);
      } catch (cmdErr: any) {
        try {
          execaSync('powershell', [
            '-NoProfile',
            '-Command',
            `New-Item -ItemType Junction -Path "${resolvedLink}" -Target "${resolvedTarget}"`,
          ]);
        } catch (psErr: any) {
          return {
            repaired: false,
            desktopJunctionPath: resolvedLink,
            targetRoot: resolvedTarget,
            action: 'failed',
            error: `Failed to create junction: ${symlinkErr.message} (cmd: ${cmdErr.message}, ps: ${psErr.message})`,
          };
        }
      }
    } else {
      try {
        fs.symlinkSync(resolvedTarget, resolvedLink, 'dir');
      } catch (posixErr: any) {
        return {
          repaired: false,
          desktopJunctionPath: resolvedLink,
          targetRoot: resolvedTarget,
          action: 'failed',
          error: `Failed to create directory symlink: ${posixErr.message}`,
        };
      }
    }
  }

  const postStatus = verifyJunction(resolvedLink, resolvedTarget);
  return {
    repaired: postStatus.valid,
    desktopJunctionPath: resolvedLink,
    targetRoot: resolvedTarget,
    action,
    error: postStatus.valid ? undefined : postStatus.message,
  };
}

/**
 * Runs comprehensive system diagnostic checks across Git, project directories, junction, config, and IPC bridge.
 */
export async function runDoctor(options?: DoctorOptions): Promise<DoctorReport> {
  const configDir = getConfigDir(options?.configDir);
  const configFile = getConfigFile(configDir);

  let rawConfig: Record<string, unknown> = {};
  if (fs.existsSync(configFile)) {
    try {
      const content = fs.readFileSync(configFile, 'utf8');
      rawConfig = JSON.parse(content);
      if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
        rawConfig = {};
      }
    } catch {
      rawConfig = {};
    }
  }

  const defaults = getDefaultConfig();
  const projectsRoot =
    options?.projectsRoot ||
    (typeof rawConfig.projectsRoot === 'string' && rawConfig.projectsRoot.trim() !== ''
      ? rawConfig.projectsRoot
      : defaults.projectsRoot);

  const throwawaysRoot =
    options?.throwawaysRoot ||
    (typeof rawConfig.throwawaysRoot === 'string' && rawConfig.throwawaysRoot.trim() !== ''
      ? rawConfig.throwawaysRoot
      : defaults.throwawaysRoot);

  const desktopJunctionPath =
    options?.desktopJunctionPath ||
    (typeof rawConfig.desktopJunctionPath === 'string' && rawConfig.desktopJunctionPath.trim() !== ''
      ? rawConfig.desktopJunctionPath
      : defaults.desktopJunctionPath || path.join(os.homedir(), 'Desktop', 'Projects'));

  const minGitVersion = options?.minGitVersion || MIN_GIT_VERSION;

  const checks: DoctorCheckResult[] = [];

  // Check 1: Git binary availability & version
  try {
    const gitResult = options?.gitExec
      ? await options.gitExec(['--version'])
      : await execa('git', ['--version']);

    const match = gitResult.stdout.match(/(\d+\.\d+(\.\d+)?)/);
    const gitVersion = match ? match[1] : null;

    if (gitVersion && compareVersions(gitVersion, minGitVersion) >= 0) {
      checks.push({
        id: 'git',
        name: 'Git binary availability',
        status: 'ok',
        message: `Git binary available (v${gitVersion} >= v${minGitVersion})`,
        fixable: false,
      });
    } else if (gitVersion) {
      checks.push({
        id: 'git',
        name: 'Git binary availability',
        status: 'warning',
        message: `Git binary version (v${gitVersion}) is below minimum recommended v${minGitVersion}`,
        fixable: false,
      });
    } else {
      checks.push({
        id: 'git',
        name: 'Git binary availability',
        status: 'warning',
        message: `Git binary is installed but version could not be parsed: "${gitResult.stdout.trim()}"`,
        fixable: false,
      });
    }
  } catch (err: any) {
    checks.push({
      id: 'git',
      name: 'Git binary availability',
      status: 'error',
      message: `Git binary not found in PATH (${err.message})`,
      fixable: false,
    });
  }

  // Check 2: Canonical projects and throwaway directories accessibility
  const projectsExists = fs.existsSync(projectsRoot);
  const throwawaysExists = fs.existsSync(throwawaysRoot);

  if (!projectsExists || !throwawaysExists) {
    const missing: string[] = [];
    if (!projectsExists) missing.push(`projects root (${projectsRoot})`);
    if (!throwawaysExists) missing.push(`throwaways root (${throwawaysRoot})`);

    checks.push({
      id: 'directories',
      name: 'Canonical projects & throwaways accessibility',
      status: 'warning',
      message: `Missing workspace directory: ${missing.join(', ')}`,
      fixable: true,
    });
  } else {
    // Verify write permissions
    let writable = true;
    try {
      const probe = path.join(projectsRoot, `.doctor_probe_${Date.now()}.tmp`);
      fs.writeFileSync(probe, 'ok', 'utf8');
      fs.unlinkSync(probe);
    } catch {
      writable = false;
    }

    if (writable) {
      checks.push({
        id: 'directories',
        name: 'Canonical projects & throwaways accessibility',
        status: 'ok',
        message: `Canonical projects and throwaways directories accessible (${projectsRoot})`,
        fixable: false,
      });
    } else {
      checks.push({
        id: 'directories',
        name: 'Canonical projects & throwaways accessibility',
        status: 'error',
        message: `Permission denied: Cannot write to projects root (${projectsRoot})`,
        fixable: false,
      });
    }
  }

  // Check 3: Desktop Junction health status
  const junctionStatus = verifyJunction(desktopJunctionPath, projectsRoot);
  if (junctionStatus.valid) {
    checks.push({
      id: 'junction',
      name: 'Desktop Junction health status',
      status: 'ok',
      message: `Desktop Junction is healthy (${desktopJunctionPath} -> ${projectsRoot})`,
      fixable: false,
    });
  } else if (!junctionStatus.exists) {
    checks.push({
      id: 'junction',
      name: 'Desktop Junction health status',
      status: 'warning',
      message: `Desktop Junction is not created (${desktopJunctionPath} -> ${projectsRoot})`,
      fixable: true,
    });
  } else {
    checks.push({
      id: 'junction',
      name: 'Desktop Junction health status',
      status: junctionStatus.isLink ? 'warning' : 'error',
      message: junctionStatus.message || `Desktop Junction is misconfigured: ${desktopJunctionPath}`,
      fixable: true,
    });
  }

  // Check 4: User configuration & templates integrity
  const templatesDir = getTemplatesDir(configDir);
  const agentsTemplate = path.join(templatesDir, DEFAULT_AGENTS_TEMPLATE_NAME);
  const gitignoreTemplate = path.join(templatesDir, DEFAULT_GITIGNORE_TEMPLATE_NAME);

  const configDirExists = fs.existsSync(configDir);
  const configFileExists = fs.existsSync(configFile);
  const agentsExists = fs.existsSync(agentsTemplate);
  const gitignoreExists = fs.existsSync(gitignoreTemplate);

  let configValid = true;
  if (configFileExists) {
    try {
      const raw = fs.readFileSync(configFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        configValid = false;
      }
    } catch {
      configValid = false;
    }
  }

  if (!configDirExists || !configFileExists || !agentsExists || !gitignoreExists || !configValid) {
    const issues: string[] = [];
    if (!configDirExists) issues.push('missing config directory');
    if (!configFileExists) issues.push('missing config.json');
    else if (!configValid) issues.push('corrupted config.json');
    if (!agentsExists) issues.push('missing AGENTS.md template');
    if (!gitignoreExists) issues.push('missing gitignore.default template');

    checks.push({
      id: 'config',
      name: 'User configuration & templates integrity',
      status: 'warning',
      message: `Configuration integrity issues: ${issues.join(', ')}`,
      fixable: true,
    });
  } else {
    checks.push({
      id: 'config',
      name: 'User configuration & templates integrity',
      status: 'ok',
      message: `User configuration and templates intact (${configDir})`,
      fixable: false,
    });
  }

  // Check 5: Shell IPC bridge readiness
  const psWrapper = path.join(configDir, 'proj.ps1');
  const cmdWrapper = path.join(configDir, 'proj.cmd');
  const psExists = fs.existsSync(psWrapper);
  const cmdExists = fs.existsSync(cmdWrapper);

  const missingIpc: string[] = [];
  if (!psExists) missingIpc.push(`PowerShell wrapper (${psWrapper})`);
  if (!cmdExists) missingIpc.push(`CMD wrapper (${cmdWrapper})`);

  // Check npm global shim on Windows if present
  if (process.platform === 'win32' && process.env.APPDATA) {
    const npmShimPath = path.join(process.env.APPDATA, 'npm', 'proj.cmd');
    if (fs.existsSync(npmShimPath)) {
      try {
        const shimContent = fs.readFileSync(npmShimPath, 'utf8');
        if (!shimContent.includes('ipc.json') || !shimContent.includes('delims=;')) {
          missingIpc.push(`npm global shim (${npmShimPath}) outdated IPC interceptor`);
        }
      } catch {
        // Ignore read error
      }
    }
  }

  if (missingIpc.length > 0) {
    checks.push({
      id: 'ipc',
      name: 'Shell IPC bridge readiness',
      status: 'warning',
      message: `Shell IPC bridge issues: ${missingIpc.join(', ')}`,
      fixable: true,
    });
  } else {
    checks.push({
      id: 'ipc',
      name: 'Shell IPC bridge readiness',
      status: 'ok',
      message: `Shell IPC bridge ready (PowerShell & CMD wrappers intact)`,
      fixable: false,
    });
  }

  const passedCount = checks.filter((c) => c.status === 'ok').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const errorCount = checks.filter((c) => c.status === 'error').length;
  const allOk = warningCount === 0 && errorCount === 0;

  return {
    timestamp: new Date().toISOString(),
    allOk,
    passedCount,
    warningCount,
    errorCount,
    checks,
  };
}

/**
 * Automatically repairs all fixable issues identified during diagnostic checks.
 */
export async function fixDoctorIssues(options?: DoctorOptions): Promise<DoctorFixReport> {
  const initialReport = await runDoctor(options);
  const repairActions: string[] = [];

  const config = getConfig(options);
  const configDir = getConfigDir(options?.configDir);
  const projectsRoot = options?.projectsRoot || config.projectsRoot;
  const throwawaysRoot = options?.throwawaysRoot || config.throwawaysRoot;
  const desktopJunctionPath =
    options?.desktopJunctionPath ||
    config.desktopJunctionPath ||
    path.join(os.homedir(), 'Desktop', 'Projects');

  // 1. Repair config & templates
  const ensured = ensureConfigDirs({ configDir });
  if (
    !fs.existsSync(ensured.configFile) ||
    !fs.existsSync(path.join(ensured.templatesDir, DEFAULT_AGENTS_TEMPLATE_NAME))
  ) {
    repairActions.push(`Ensured configuration & template integrity at ${configDir}`);
  } else {
    repairActions.push(`Verified and ensured configuration & template files at ${configDir}`);
  }

  // 2. Repair workspace directories
  if (!fs.existsSync(projectsRoot)) {
    fs.mkdirSync(projectsRoot, { recursive: true });
    repairActions.push(`Created canonical projects directory: ${projectsRoot}`);
  }
  if (!fs.existsSync(throwawaysRoot)) {
    fs.mkdirSync(throwawaysRoot, { recursive: true });
    repairActions.push(`Created throwaways directory: ${throwawaysRoot}`);
  }

  // 3. Repair Desktop Junction
  const junctionResult = repairJunction(desktopJunctionPath, projectsRoot);
  if (junctionResult.action === 'created') {
    repairActions.push(
      `Created Desktop Directory Junction: ${desktopJunctionPath} -> ${projectsRoot}`
    );
  } else if (junctionResult.action === 're-linked') {
    repairActions.push(
      `Re-linked Desktop Directory Junction: ${desktopJunctionPath} -> ${projectsRoot}`
    );
  }

  // 4. Repair Shell IPC bridge wrappers (PowerShell & CMD)
  const psWrapper = path.join(configDir, 'proj.ps1');
  if (!fs.existsSync(psWrapper)) {
    writePowerShellWrapper(psWrapper, { configDir });
    repairActions.push(`Generated PowerShell IPC bridge wrapper script: ${psWrapper}`);
  }

  const cmdWrapper = path.join(configDir, 'proj.cmd');
  writeCmdWrapper(cmdWrapper, { configDir });
  repairActions.push(`Generated CMD IPC bridge wrapper script: ${cmdWrapper}`);

  if (process.platform === 'win32' && process.env.APPDATA) {
    const npmShimPath = path.join(process.env.APPDATA, 'npm', 'proj.cmd');
    if (fs.existsSync(npmShimPath)) {
      try {
        const shimContent = fs.readFileSync(npmShimPath, 'utf8');
        if (!shimContent.includes('ipc.json') || !shimContent.includes('delims=;')) {
          writeCmdWrapper(npmShimPath, { isNpmShim: true });
          repairActions.push(`Updated npm global shim with IPC interceptor: ${npmShimPath}`);
        }
      } catch {
        // Ignore read/write error
      }
    }
  }

  const fixedReport = await runDoctor(options);
  const initialUnhealthy = initialReport.warningCount + initialReport.errorCount;
  const fixedUnhealthy = fixedReport.warningCount + fixedReport.errorCount;
  const fixedCount = Math.max(0, initialUnhealthy - fixedUnhealthy);

  return {
    timestamp: new Date().toISOString(),
    initialReport,
    fixedReport,
    fixedCount,
    unfixedCount: fixedUnhealthy,
    repairActions,
  };
}

/**
 * Formats diagnostic report into a readable string.
 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ['System Diagnostics (proj doctor):', ''];

  for (const check of report.checks) {
    const symbol =
      check.status === 'ok'
        ? pc.green('[✓]')
        : check.status === 'warning'
        ? pc.yellow('[!]')
        : pc.red('[x]');
    lines.push(`  ${symbol} ${check.name}: ${check.message}`);
  }

  lines.push('');
  const summaryLine = `Diagnostic Summary: ${report.passedCount} passed, ${report.warningCount} warnings, ${report.errorCount} errors.`;

  if (report.allOk) {
    lines.push(`${summaryLine} ${pc.green('All systems healthy!')}`);
  } else {
    lines.push(summaryLine);
    const fixableChecks = report.checks.filter((c) => c.status !== 'ok' && c.fixable);
    if (fixableChecks.length > 0) {
      lines.push(pc.cyan('Run "proj doctor --fix" to automatically repair detected issues.'));
    }
  }

  return lines.join('\n');
}

/**
 * Formats self-healing repair report into a readable string.
 */
export function formatDoctorFixReport(fixReport: DoctorFixReport): string {
  const lines: string[] = ['System Diagnostics & Self-Healing (proj doctor --fix):', ''];

  if (fixReport.repairActions.length > 0) {
    lines.push('Repairs executed:');
    for (const action of fixReport.repairActions) {
      lines.push(`  ${pc.green('+')} ${action}`);
    }
    lines.push('');
  } else {
    lines.push('No repairs needed.');
    lines.push('');
  }

  lines.push('Post-repair Diagnostic Status:');
  for (const check of fixReport.fixedReport.checks) {
    const symbol =
      check.status === 'ok'
        ? pc.green('[✓]')
        : check.status === 'warning'
        ? pc.yellow('[!]')
        : pc.red('[x]');
    lines.push(`  ${symbol} ${check.name}: ${check.message}`);
  }

  lines.push('');
  const summaryLine = `Diagnostic Summary: ${fixReport.fixedReport.passedCount} passed, ${fixReport.fixedReport.warningCount} warnings, ${fixReport.fixedReport.errorCount} errors.`;

  if (fixReport.fixedReport.allOk) {
    lines.push(`${summaryLine} ${pc.green('All issues successfully repaired!')}`);
  } else {
    lines.push(summaryLine);
  }

  return lines.join('\n');
}
