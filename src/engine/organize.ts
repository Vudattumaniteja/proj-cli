import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/index.js';
import { RESERVED_FOLDER_NAMES, resolveProject } from './discovery.js';
import { validateGroupName } from './scaffold.js';
import type {
  GroupInfo,
  OrganizeOptions,
  MoveProjectResult,
  DeleteGroupOptions,
  DeleteGroupResult,
} from './types.js';

export { validateGroupName } from './scaffold.js';
export * from './types.js';

/**
 * Creates a new group directory under canonical projects root.
 */
export async function createGroup(
  name: string,
  options?: OrganizeOptions
): Promise<GroupInfo> {
  validateGroupName(name);
  const trimmed = name.trim();

  const config = getConfig({ configDir: options?.configDir });
  const projectsRoot = options?.projectsRoot
    ? path.resolve(options.projectsRoot)
    : path.resolve(config.projectsRoot);

  const groupPath = path.join(projectsRoot, trimmed);

  if (fs.existsSync(groupPath)) {
    throw new Error(`Group or directory "${trimmed}" already exists at "${groupPath}"`);
  }

  fs.mkdirSync(groupPath, { recursive: true });

  return {
    name: trimmed,
    path: path.resolve(groupPath),
    projectCount: 0,
    projects: [],
  };
}

/**
 * Deletes a group directory under canonical projects root.
 * Guards against non-empty groups unless force option is supplied.
 */
export async function deleteGroup(
  name: string,
  options?: DeleteGroupOptions
): Promise<DeleteGroupResult> {
  validateGroupName(name);
  const trimmed = name.trim();

  const config = getConfig({ configDir: options?.configDir });
  const projectsRoot = options?.projectsRoot
    ? path.resolve(options.projectsRoot)
    : path.resolve(config.projectsRoot);

  const groupPath = path.join(projectsRoot, trimmed);

  if (!fs.existsSync(groupPath) || !fs.statSync(groupPath).isDirectory()) {
    throw new Error(`Cannot locate group "${trimmed}": Group directory not found at "${groupPath}"`);
  }

  // Prevent deleting projects root
  if (path.resolve(groupPath) === path.resolve(projectsRoot)) {
    throw new Error(`Cannot delete root projects directory as a group`);
  }

  const entries = fs.readdirSync(groupPath);
  if (entries.length > 0 && !options?.force) {
    throw new Error(
      `Cannot delete group "${trimmed}": Group is not empty (${entries.length} item${entries.length === 1 ? '' : 's'} found). Use force option to delete non-empty groups.`
    );
  }

  fs.rmSync(groupPath, { recursive: true, force: true });

  return {
    name: trimmed,
    path: path.resolve(groupPath),
    deleted: true,
  };
}

/**
 * Relocates a project between root workspace and group subfolders while preserving Git metadata.
 */
export async function moveProject(
  sourcePathOrName: string,
  targetGroup: string | null | undefined,
  options?: OrganizeOptions
): Promise<MoveProjectResult> {
  if (typeof sourcePathOrName !== 'string' || sourcePathOrName.trim() === '') {
    throw new Error('Invalid project identifier: project name or path cannot be empty');
  }

  const config = getConfig({ configDir: options?.configDir });
  const projectsRoot = options?.projectsRoot
    ? path.resolve(options.projectsRoot)
    : path.resolve(config.projectsRoot);

  const throwawaysRoot = options?.throwawaysRoot
    ? path.resolve(options.throwawaysRoot)
    : config.throwawaysRoot
      ? path.resolve(config.throwawaysRoot)
      : path.join(projectsRoot, 'throwaways');

  // Resolve source project
  const resolveResult = await resolveProject(sourcePathOrName, projectsRoot, {
    configDir: options?.configDir,
    throwawaysRoot,
  });

  if (!resolveResult.resolved || !resolveResult.targetPath || !resolveResult.project) {
    if (resolveResult.isAmbiguous) {
      const matchPaths = resolveResult.ambiguousMatches.map((m) => m.path).join(', ');
      throw new Error(
        `Ambiguous project name "${sourcePathOrName}". Found ${resolveResult.ambiguousMatches.length} matching projects: ${matchPaths}`
      );
    }
    throw new Error(`Cannot locate project "${sourcePathOrName}": Project not found in workspace`);
  }

  const sourceProject = resolveResult.project;

  if (resolveResult.type === 'throwaway' || sourceProject.isThrowaway) {
    throw new Error(
      `Cannot move throwaway scratchpad "${sourceProject.name}". Use "graduate" to convert it to a permanent project first.`
    );
  }

  if (resolveResult.type === 'group') {
    throw new Error(`Cannot move group "${sourcePathOrName}" using moveProject.`);
  }

  // Determine target group name
  let targetGroupName: string | undefined = undefined;
  if (
    targetGroup !== null &&
    targetGroup !== undefined &&
    targetGroup.trim() !== '' &&
    targetGroup.trim().toLowerCase() !== 'root'
  ) {
    targetGroupName = targetGroup.trim();
    validateGroupName(targetGroupName);
  }

  const targetParentDir = targetGroupName
    ? path.join(projectsRoot, targetGroupName)
    : projectsRoot;

  const targetProjectPath = path.join(targetParentDir, sourceProject.name);

  // Check if source and destination are identical
  if (path.resolve(sourceProject.path) === path.resolve(targetProjectPath)) {
    throw new Error(
      `Project "${sourceProject.name}" is already in ${targetGroupName ? `group "${targetGroupName}"` : 'the root workspace'}`
    );
  }

  // Check destination collision
  if (fs.existsSync(targetProjectPath)) {
    throw new Error(
      `Cannot move project "${sourceProject.name}": Destination path already exists at "${targetProjectPath}"`
    );
  }

  // Ensure target parent directory exists
  if (!fs.existsSync(targetParentDir)) {
    fs.mkdirSync(targetParentDir, { recursive: true });
  }

  // Move project directory
  try {
    fs.renameSync(sourceProject.path, targetProjectPath);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'EXDEV') {
      fs.cpSync(sourceProject.path, targetProjectPath, { recursive: true });
      fs.rmSync(sourceProject.path, { recursive: true, force: true });
    } else {
      throw err;
    }
  }

  // Auto-prune empty source group folder if project was inside a group
  const sourceParentDir = path.dirname(sourceProject.path);
  if (
    path.resolve(path.dirname(sourceParentDir)) === path.resolve(projectsRoot) &&
    path.resolve(sourceParentDir) !== path.resolve(projectsRoot) &&
    path.resolve(sourceParentDir) !== path.resolve(throwawaysRoot)
  ) {
    const sourceGroupName = path.basename(sourceParentDir);
    if (!RESERVED_FOLDER_NAMES.has(sourceGroupName.toLowerCase()) && fs.existsSync(sourceParentDir)) {
      try {
        const remaining = fs.readdirSync(sourceParentDir);
        if (remaining.length === 0) {
          fs.rmSync(sourceParentDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore prune errors on source group directory
      }
    }
  }

  return {
    name: sourceProject.name,
    path: path.resolve(targetProjectPath),
    previousPath: path.resolve(sourceProject.path),
    group: targetGroupName,
    previousGroup: sourceProject.group,
  };
}
