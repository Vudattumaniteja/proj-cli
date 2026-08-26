import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import { getConfig, updateConfig } from '../config/index.js';
import { parseGitHubRemote } from './discovery.js';
import { findThrowawayEntry } from './throwaway.js';
import type { DeleteProjectOptions, DeleteProjectResult } from './types.js';

export * from './types.js';

/**
 * Safely deletes a project from disk, checking for uncommitted changes,
 * and optionally deletes the remote GitHub repository via the GitHub CLI (`gh`).
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
    // 2. Check canonical workspace root
    const canonicalCandidate = path.join(projectsRoot, trimmed);
    if (fs.existsSync(canonicalCandidate) && fs.statSync(canonicalCandidate).isDirectory()) {
      projectPath = canonicalCandidate;
    }

    // 3. Check throwaways root
    if (!projectPath && throwawaysRoot) {
      const throwawaysCandidate = path.join(throwawaysRoot, trimmed);
      if (fs.existsSync(throwawaysCandidate) && fs.statSync(throwawaysCandidate).isDirectory()) {
        projectPath = throwawaysCandidate;
      }
    }

    // 4. Check throwaways registry in config
    if (!projectPath) {
      const throwaways = config.throwaways || {};
      const found = findThrowawayEntry(throwaways, trimmed);
      if (
        found?.record?.path &&
        fs.existsSync(found.record.path) &&
        fs.statSync(found.record.path).isDirectory()
      ) {
        projectPath = path.resolve(found.record.path);
      }
    }

    // 5. Fallback check for relative path
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

  // 6. Check Git status and uncommitted changes
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

  // 7. If cloud: true, delete remote repository via GitHub CLI
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

  // 8. Permanently remove project directory from disk
  fs.rmSync(projectPath, { recursive: true, force: true });

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
  };
}
