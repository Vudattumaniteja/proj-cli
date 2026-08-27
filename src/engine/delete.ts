import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import { getConfig, updateConfig } from '../config/index.js';
import { parseGitHubRemote, RESERVED_FOLDER_NAMES, resolveProject } from './discovery.js';
import { findThrowawayEntry } from './throwaway.js';
import type { DeleteProjectOptions, DeleteProjectResult } from './types.js';

export * from './types.js';

/**
 * Safely deletes a project from disk, checking for uncommitted changes,
 * auto-pruning empty parent group folders, and optionally deletes the remote
 * GitHub repository via the GitHub CLI (`gh`).
 */
export async function deleteProject(
  target: string,
  options?: DeleteProjectOptions
): Promise<DeleteProjectResult> {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('Invalid target: Project target path or name cannot be empty');
  }

  const trimmed = target.trim();
  const config = getConfig({ configDir: options?.configDir });

  const projectsRoot = options?.projectsRoot
    ? path.resolve(options.projectsRoot)
    : path.resolve(config.projectsRoot);

  const throwawaysRoot = options?.throwawaysRoot
    ? path.resolve(options.throwawaysRoot)
    : config.throwawaysRoot
      ? path.resolve(config.throwawaysRoot)
      : path.join(projectsRoot, 'throwaways');

  let projectPath: string | null = null;

  // 1. Check if target is an explicit relative or absolute path
  const isExplicitPath =
    trimmed === '.' ||
    trimmed.startsWith('.' + path.sep) ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('.\\') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('..\\') ||
    path.isAbsolute(trimmed);

  if (isExplicitPath) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      projectPath = resolved;
    } else {
      throw new Error(`Cannot locate project "${trimmed}": Project directory not found at "${resolved}"`);
    }
  } else {
    // 2. Use resolveProject to look across root, groups, and throwaways
    const resolveResult = await resolveProject(trimmed, projectsRoot, {
      configDir: options?.configDir,
      throwawaysRoot,
    });

    if (resolveResult.resolved && resolveResult.targetPath) {
      if (resolveResult.type === 'group') {
        if (resolveResult.group && resolveResult.group.projectCount > 0) {
          throw new Error(`Cannot locate project "${trimmed}": Target is a group folder, not a project`);
        }
        projectPath = resolveResult.targetPath;
      } else {
        projectPath = resolveResult.targetPath;
      }
    } else if (resolveResult.isAmbiguous) {
      const matchPaths = resolveResult.ambiguousMatches.map((m) => m.path).join(', ');
      throw new Error(
        `Ambiguous project name "${trimmed}". Found multiple matching projects across groups: ${matchPaths}`
      );
    }

    // 3. Fallback: check throwaways registry in config
    if (!projectPath && config.throwaways) {
      const found = findThrowawayEntry(config.throwaways, trimmed);
      if (
        found?.record?.path &&
        fs.existsSync(found.record.path) &&
        fs.statSync(found.record.path).isDirectory()
      ) {
        projectPath = path.resolve(found.record.path);
      }
    }

    // 4. Fallback: check relative path from cwd
    if (!projectPath) {
      const relativeCandidate = path.resolve(trimmed);
      if (fs.existsSync(relativeCandidate) && fs.statSync(relativeCandidate).isDirectory()) {
        projectPath = relativeCandidate;
      }
    }

    if (!projectPath) {
      throw new Error(
        `Cannot locate project "${trimmed}": not found in workspace root (${projectsRoot}) or relative path`
      );
    }
  }

  const projectName = path.basename(projectPath);

  // 5. Check Git status and uncommitted changes
  const gitDir = path.join(projectPath, '.git');
  let isRepo = false;
  const git = simpleGit(projectPath, { maxConcurrentProcesses: 2 });

  if (fs.existsSync(gitDir)) {
    try {
      isRepo = await git.checkIsRepo();
    } catch {
      isRepo = false;
    }
  }

  if (isRepo) {
    const status = await git.status();
    const dirtyCount = status.files.length;
    if (dirtyCount > 0 && !options?.force) {
      throw new Error(
        `Cannot delete project "${projectName}": working tree has ${dirtyCount} uncommitted change${dirtyCount === 1 ? '' : 's'}. Use --force to override.`
      );
    }
  }

  // 6. If cloud: true, delete remote repository via GitHub CLI
  let cloudDeleted = false;
  if (options?.cloud) {
    if (!isRepo) {
      throw new Error(`Cannot delete cloud repository: "${projectName}" is not a Git repository`);
    }

    const remotes = await git.getRemotes(true).catch(() => []);
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    const remoteUrl = origin?.refs?.fetch || origin?.refs?.push;

    if (!origin || !remoteUrl) {
      throw new Error(
        `Cannot delete cloud repository for "${projectName}": no GitHub remote origin configured`
      );
    }

    const githubInfo = parseGitHubRemote(remoteUrl);
    if (!githubInfo) {
      throw new Error(
        `Cannot delete cloud repository for "${projectName}": remote "${remoteUrl}" is not a valid GitHub remote`
      );
    }

    try {
      await execa('gh', ['repo', 'delete', `${githubInfo.owner}/${githubInfo.repo}`, '--yes'], {
        cwd: projectPath,
      });
      cloudDeleted = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: string })?.stderr || '';
      const stdout = (err as { stdout?: string })?.stdout || '';
      const combined = `${msg} ${stderr} ${stdout}`.toLowerCase();

      if (
        combined.includes('delete_repo') ||
        combined.includes('scope') ||
        combined.includes('insufficient_scope')
      ) {
        throw new Error(
          `GitHub CLI requires the "delete_repo" OAuth scope to delete remote repositories. Run "gh auth refresh -s delete_repo" to grant permission.`
        );
      }

      throw new Error(`Failed to delete remote GitHub repository: ${msg}`);
    }
  }

  // 7. Permanently remove project directory from disk
  fs.rmSync(projectPath, { recursive: true, force: true });

  // 8. Auto-prune empty parent group folder if project was inside a 1-level group folder
  let groupPruned = false;
  let prunedGroup: string | undefined = undefined;

  const parentDir = path.dirname(projectPath);
  if (
    path.resolve(path.dirname(parentDir)) === path.resolve(projectsRoot) &&
    path.resolve(parentDir) !== path.resolve(projectsRoot) &&
    path.resolve(parentDir) !== path.resolve(throwawaysRoot)
  ) {
    const groupName = path.basename(parentDir);
    if (!RESERVED_FOLDER_NAMES.has(groupName.toLowerCase()) && fs.existsSync(parentDir)) {
      try {
        const remainingEntries = fs.readdirSync(parentDir);
        if (remainingEntries.length === 0) {
          fs.rmSync(parentDir, { recursive: true, force: true });
          groupPruned = true;
          prunedGroup = groupName;
        }
      } catch {
        // Ignore read/rm error on parent directory
      }
    }
  }

  // 9. Clean up throwaway registry in config if present
  if (config.throwaways) {
    const foundThrowaway = findThrowawayEntry(config.throwaways, projectName);
    if (foundThrowaway) {
      const updatedThrowaways = { ...config.throwaways };
      delete updatedThrowaways[foundThrowaway.key];
      updateConfig(
        { throwaways: updatedThrowaways },
        { configDir: options?.configDir }
      );
    }
  }

  return {
    name: projectName,
    path: projectPath,
    cloudDeleted,
    ...(groupPruned ? { groupPruned: true, prunedGroup } : {}),
  };
}
