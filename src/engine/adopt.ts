import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  getConfig,
  getTemplatesDir,
  normalizeInputPath,
  DEFAULT_AGENTS_TEMPLATE,
  DEFAULT_GITIGNORE_TEMPLATE,
  DEFAULT_AGENTS_TEMPLATE_NAME,
  DEFAULT_GITIGNORE_TEMPLATE_NAME,
} from '../config/index.js';
import { validateProjectName } from './scaffold.js';
import type { AdoptOptions, AdoptResult } from './types.js';

export * from './types.js';

/**
 * Safely adopts an external or desktop folder into the canonical projects root,
 * ensuring Git tracking and injecting standard AI agent guardrails.
 */
export async function adoptProject(
  folderPath: string,
  options?: AdoptOptions
): Promise<AdoptResult> {
  if (typeof folderPath !== 'string' || folderPath.trim() === '') {
    throw new Error('Invalid folder path: path cannot be empty');
  }

  let resolvedSource: string;
  try {
    resolvedSource = normalizeInputPath(folderPath);
  } catch (err: unknown) {
    throw new Error(`Invalid folder path: ${err instanceof Error ? err.message : 'path cannot be empty'}`);
  }

  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Cannot adopt folder: "${resolvedSource}" does not exist`);
  }

  const sourceStat = fs.statSync(resolvedSource);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Cannot adopt path "${resolvedSource}": path is not a directory`);
  }

  const projectName = (options?.name || path.basename(resolvedSource)).trim();
  validateProjectName(projectName);

  const config = getConfig({ configDir: options?.configDir });
  const projectsRoot = options?.projectsRoot
    ? path.resolve(options.projectsRoot)
    : path.resolve(config.projectsRoot);

  const destPath = path.join(projectsRoot, projectName);

  if (path.resolve(resolvedSource) === path.resolve(destPath)) {
    throw new Error(
      `Cannot adopt "${projectName}": folder is already located at canonical path ${destPath}`
    );
  }

  if (fs.existsSync(destPath)) {
    throw new Error(
      `Cannot adopt "${projectName}": destination path already exists at ${destPath}`
    );
  }

  if (!fs.existsSync(projectsRoot)) {
    fs.mkdirSync(projectsRoot, { recursive: true });
  }

  // Move source folder into canonical projects root
  try {
    fs.renameSync(resolvedSource, destPath);
  } catch {
    // Cross-filesystem or permission fallback
    fs.cpSync(resolvedSource, destPath, { recursive: true });
    fs.rmSync(resolvedSource, { recursive: true, force: true });
  }

  // Inject standard AGENTS.md and .gitignore if not present
  const templatesDir = getTemplatesDir(options?.configDir);
  const gitignorePath = path.join(destPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    let gitignoreContent = DEFAULT_GITIGNORE_TEMPLATE;
    const customGitignore = path.join(templatesDir, DEFAULT_GITIGNORE_TEMPLATE_NAME);
    if (fs.existsSync(customGitignore)) {
      try {
        gitignoreContent = fs.readFileSync(customGitignore, 'utf8');
      } catch {
        gitignoreContent = DEFAULT_GITIGNORE_TEMPLATE;
      }
    }
    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');
  }

  const agentsPath = path.join(destPath, DEFAULT_AGENTS_TEMPLATE_NAME);
  if (!fs.existsSync(agentsPath)) {
    let agentsContent = DEFAULT_AGENTS_TEMPLATE;
    const customAgents = path.join(templatesDir, DEFAULT_AGENTS_TEMPLATE_NAME);
    if (fs.existsSync(customAgents)) {
      try {
        agentsContent = fs.readFileSync(customAgents, 'utf8');
      } catch {
        agentsContent = DEFAULT_AGENTS_TEMPLATE;
      }
    }
    fs.writeFileSync(agentsPath, agentsContent, 'utf8');
  }

  // Ensure Git repository initialization
  const git = simpleGit(destPath, { maxConcurrentProcesses: 2 });
  let isRepo = false;
  try {
    isRepo = await git.checkIsRepo();
  } catch {
    isRepo = false;
  }

  let commitHash: string | undefined;

  if (!isRepo) {
    await git.init();
    await git.addConfig('user.name', options?.gitAuthorName || 'proj-agent', false, 'local');
    await git.addConfig('user.email', options?.gitAuthorEmail || 'agent@proj.local', false, 'local');
    await git.add('.');
    await git.commit('checkpoint: Adopted project into canonical root');
    commitHash = (await git.revparse(['HEAD'])).trim();
  } else {
    try {
      commitHash = (await git.revparse(['HEAD'])).trim();
    } catch {
      // Empty Git repo initialized without commits
      await git.addConfig('user.name', options?.gitAuthorName || 'proj-agent', false, 'local');
      await git.addConfig('user.email', options?.gitAuthorEmail || 'agent@proj.local', false, 'local');
      await git.add('.');
      await git.commit('checkpoint: Adopted project into canonical root');
      commitHash = (await git.revparse(['HEAD'])).trim();
    }
  }

  return {
    name: projectName,
    path: destPath,
    previousPath: resolvedSource,
    isGit: true,
    commitHash,
  };
}
