import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import { getConfig } from '../config/index.js';
import { findThrowawayEntry } from './throwaway.js';
import type { PublishOptions, PublishResult } from './types.js';

export * from './types.js';

/**
 * Publishes a local workspace project to a private GitHub repository using the GitHub CLI (`gh`).
 */
export async function publishProject(
  target: string,
  options?: PublishOptions
): Promise<PublishResult> {
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
    if (!projectPath) {
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
        `Cannot locate project "${trimmed}": not found in workspace root (${projectsRoot}), throwaways (${throwawaysRoot}), or relative path`
      );
    }
  }

  const projectName = (options?.repoName || path.basename(projectPath)).trim();

  // 6. Ensure Git repository initialization
  const git = simpleGit(projectPath, { maxConcurrentProcesses: 2 });
  const gitDir = path.join(projectPath, '.git');
  let isRepo = false;

  if (fs.existsSync(gitDir)) {
    try {
      isRepo = await git.checkIsRepo();
    } catch {
      isRepo = false;
    }
  }

  if (!isRepo) {
    await git.init();
    await git.addConfig('user.name', options?.gitAuthorName || 'proj-agent', false, 'local');
    await git.addConfig('user.email', options?.gitAuthorEmail || 'agent@proj.local', false, 'local');
  } else {
    if (options?.gitAuthorName) {
      await git.addConfig('user.name', options.gitAuthorName, false, 'local');
    }
    if (options?.gitAuthorEmail) {
      await git.addConfig('user.email', options.gitAuthorEmail, false, 'local');
    }
  }

  // 7. Verify remote origin is not already configured
  const remotes = await git.getRemotes(true).catch(() => []);
  const originRemote = remotes.find((r) => r.name === 'origin');
  if (originRemote) {
    const originUrl = originRemote.refs?.fetch || originRemote.refs?.push || '';
    throw new Error(
      `Cannot publish "${projectName}": remote "origin" is already configured${originUrl ? ` (${originUrl})` : ''}`
    );
  }

  // 8. Safety checkpoint snapshot if working tree is dirty
  const status = await git.status();
  if (status.files.length > 0) {
    await git.add('.');
    await git.commit('checkpoint: pre-publish snapshot');
  }

  // 9. Execute gh repo create via execa
  let execResult;
  try {
    execResult = await execa(
      'gh',
      ['repo', 'create', projectName, '--private', '--source', '.', '--remote', 'origin', '--push'],
      { cwd: projectPath }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to publish project to GitHub: ${msg}`);
  }

  // 10. Extract structured repository URL
  let repoUrl = '';
  try {
    const updatedRemotes = await git.getRemotes(true);
    const updatedOrigin = updatedRemotes.find((r) => r.name === 'origin');
    if (updatedOrigin?.refs?.push || updatedOrigin?.refs?.fetch) {
      repoUrl = updatedOrigin.refs.push || updatedOrigin.refs.fetch;
    }
  } catch {
    // Ignore
  }

  if (!repoUrl && execResult?.stdout) {
    const match = execResult.stdout.match(/https?:\/\/[^\s]+|git@[^\s]+/);
    if (match) {
      repoUrl = match[0].trim();
    }
  }

  if (!repoUrl) {
    repoUrl = `https://github.com/${projectName}`;
  }

  return {
    name: projectName,
    path: projectPath,
    repoUrl,
    isPrivate: true,
  };
}
