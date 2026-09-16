import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { getConfig } from '../config/index.js';
import { isThrowawayExpired, findThrowawayEntry } from './throwaway.js';
import type {
  ProjectInfo,
  DiscoveryOptions,
  GroupInfo,
  ResolveProjectResult,
  ResolvedTargetType,
} from './types.js';

export * from './types.js';

export const RESERVED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  'throwaways',
  '.git',
  '.proj',
  'node_modules',
  'dist',
]);

/**
 * Detects the project template/type from known marker files.
 */
export function detectTemplateType(dirPath: string): string | null {
  if (!fs.existsSync(dirPath)) return null;

  try {
    const entries = fs.readdirSync(dirPath);
    const files = new Set(entries);

    // 1. TypeScript
    if (files.has('tsconfig.json')) {
      return 'typescript';
    }

    if (files.has('package.json')) {
      try {
        const pkgContent = fs.readFileSync(path.join(dirPath, 'package.json'), 'utf8');
        const pkg = JSON.parse(pkgContent);
        if (
          pkg.devDependencies?.typescript ||
          pkg.dependencies?.typescript ||
          pkg.types ||
          pkg.typings
        ) {
          return 'typescript';
        }
      } catch {
        // Ignore parse error
      }
    }

    // Check for .ts files in root or src
    if (entries.some((f) => f.endsWith('.ts') || f.endsWith('.tsx'))) {
      return 'typescript';
    }
    const srcPath = path.join(dirPath, 'src');
    if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
      try {
        const srcFiles = fs.readdirSync(srcPath);
        if (srcFiles.some((f) => f.endsWith('.ts') || f.endsWith('.tsx'))) {
          return 'typescript';
        }
      } catch {
        // Ignore read error
      }
    }

    // 2. Python
    if (
      files.has('pyproject.toml') ||
      files.has('requirements.txt') ||
      files.has('Pipfile') ||
      files.has('setup.py') ||
      files.has('environment.yml') ||
      entries.some((f) => f.endsWith('.py'))
    ) {
      return 'python';
    }

    // 3. Rust
    if (files.has('Cargo.toml')) {
      return 'rust';
    }

    // 4. Go
    if (files.has('go.mod')) {
      return 'go';
    }

    // 5. Web Starter (Vite, Next, Astro, Svelte, Webpack, index.html)
    if (
      files.has('vite.config.ts') ||
      files.has('vite.config.js') ||
      files.has('next.config.js') ||
      files.has('next.config.mjs') ||
      files.has('next.config.ts') ||
      files.has('astro.config.mjs') ||
      files.has('svelte.config.js') ||
      files.has('index.html')
    ) {
      return 'web';
    }

    // 6. Node.js / JavaScript
    if (files.has('package.json')) {
      return 'node';
    }

    // 7. Minimal (has AGENTS.md, .gitignore, or README.md)
    if (files.has('AGENTS.md') || files.has('.gitignore') || files.has('README.md')) {
      return 'minimal';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parses a Git remote URL and returns GitHub repository details if it targets GitHub.
 * Supports both HTTPS (https://github.com/owner/repo.git) and SSH (git@github.com:owner/repo.git) formats.
 */
export function parseGitHubRemote(
  remoteUrl: string
): { owner: string; repo: string; webUrl: string } | undefined {
  if (!remoteUrl || typeof remoteUrl !== 'string') return undefined;

  const trimmed = remoteUrl.trim().replace(/\/+$/, '');

  // 1. SSH / SCP-like syntax: git@github.com:owner/repo[.git]
  const scpMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (scpMatch) {
    const owner = scpMatch[1];
    const repo = scpMatch[2].replace(/\.git$/i, '');
    return {
      owner,
      repo,
      webUrl: `https://github.com/${owner}/${repo}`,
    };
  }

  // 2. Standard URL syntax: [protocol://][user(:pass)@]github.com[:port]/owner/repo[.git]
  const urlMatch = trimmed.match(
    /^(?:https?|git|ssh|git\+https?):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?$/i
  );
  if (urlMatch) {
    const owner = urlMatch[1];
    const repo = urlMatch[2].replace(/\.git$/i, '');
    return {
      owner,
      repo,
      webUrl: `https://github.com/${owner}/${repo}`,
    };
  }

  return undefined;
}

/**
 * Returns formatted template badge string (e.g. `[typescript]`).
 */
export function getTemplateBadge(templateType: string | null): string {
  if (!templateType) {
    return '[unknown]';
  }
  return `[${templateType}]`;
}

export interface InspectProjectOptions {
  isThrowaway?: boolean;
  group?: string;
  configDir?: string;
  now?: Date | string | number;
}

/**
 * Inspects a single project directory and extracts Git status, template type, and metadata.
 */
export async function inspectProject(
  projectPath: string,
  options?: InspectProjectOptions
): Promise<ProjectInfo> {
  const resolvedPath = path.resolve(projectPath);
  const name = path.basename(resolvedPath);
  const isThrowaway = options?.isThrowaway ?? false;
  const group = options?.group;

  let expiresAt: string | undefined;
  let isExpired: boolean | undefined;

  if (isThrowaway) {
    try {
      const config = getConfig({ configDir: options?.configDir });
      const record = findThrowawayEntry(config.throwaways, name)?.record;
      if (record) {
        expiresAt = record.expiresAt;
        isExpired = isThrowawayExpired(record, options?.now);
      }
    } catch {
      // Gracefully handle config errors
    }
  }

  let lastModified = new Date(0);
  try {
    const stat = fs.statSync(resolvedPath);
    lastModified = stat.mtime;
  } catch {
    // Keep epoch fallback
  }

  const templateType = detectTemplateType(resolvedPath);
  const templateBadge = getTemplateBadge(templateType);

  const gitDir = path.join(resolvedPath, '.git');
  let isGit = false;
  let branch: string | null = null;
  let dirtyCount = 0;
  let hasRemote = false;
  let remoteUrl: string | undefined = undefined;
  let githubRepo: { owner: string; repo: string; webUrl: string } | undefined = undefined;

  if (fs.existsSync(gitDir)) {
    try {
      const git = simpleGit(resolvedPath, { maxConcurrentProcesses: 2 });
      const isRepo = await git.checkIsRepo();
      if (isRepo) {
        isGit = true;
        try {
          const [status, remotes] = await Promise.all([
            git.status().catch(() => null),
            git.getRemotes(true).catch(() => []),
          ]);

          if (status) {
            branch = status.current || 'HEAD';
            dirtyCount = status.files.length;
          }

          if (remotes && remotes.length > 0) {
            const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
            const url = origin?.refs?.fetch || origin?.refs?.push;
            if (url) {
              hasRemote = true;
              remoteUrl = url;
              const parsed = parseGitHubRemote(url);
              if (parsed) {
                githubRepo = parsed;
              }
            }
          }
        } catch {
          // Gracefully handle git errors without crashing
        }
      }
    } catch {
      // Gracefully handle git errors without crashing
      isGit = true;
      branch = null;
      dirtyCount = 0;
      hasRemote = false;
      remoteUrl = undefined;
      githubRepo = undefined;
    }
  }

  return {
    name,
    path: resolvedPath,
    isGit,
    branch,
    dirtyCount,
    isDirty: dirtyCount > 0,
    templateType,
    templateBadge,
    lastModified,
    isThrowaway,
    expiresAt,
    isExpired,
    hasRemote,
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(githubRepo ? { githubRepo } : {}),
    ...(group ? { group } : {}),
  };
}

/**
 * Concurrently processes an array of items with a bounded concurrency limit.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Scans the canonical projects directory and throwaways directory, returning structured ProjectInfo list.
 * Scans both root projects and 1-level group subfolders with bounded parallel inspection.
 */
export async function listProjects(
  canonicalRoot: string,
  options?: DiscoveryOptions
): Promise<ProjectInfo[]> {
  const resolvedCanonicalRoot = path.resolve(canonicalRoot);
  let resolvedThrowawaysRoot: string;
  if (options?.throwawaysRoot) {
    resolvedThrowawaysRoot = path.resolve(options.throwawaysRoot);
  } else if (options?.configDir) {
    try {
      const config = getConfig({ configDir: options.configDir });
      resolvedThrowawaysRoot = config.throwawaysRoot
        ? path.resolve(config.throwawaysRoot)
        : path.join(resolvedCanonicalRoot, 'throwaways');
    } catch {
      resolvedThrowawaysRoot = path.join(resolvedCanonicalRoot, 'throwaways');
    }
  } else {
    resolvedThrowawaysRoot = path.join(resolvedCanonicalRoot, 'throwaways');
  }

  interface ProjectTarget {
    fullPath: string;
    isThrowaway: boolean;
    group?: string;
  }
  const targets: ProjectTarget[] = [];

  // 1. Scan canonicalRoot if it exists
  if (fs.existsSync(resolvedCanonicalRoot)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(resolvedCanonicalRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue;
      if (RESERVED_FOLDER_NAMES.has(entry.name)) continue;

      const fullPath = path.join(resolvedCanonicalRoot, entry.name);

      // If this directory is the throwaways root, skip it as a regular project
      if (path.resolve(fullPath) === resolvedThrowawaysRoot) {
        continue;
      }

      const hasGit = fs.existsSync(path.join(fullPath, '.git'));
      const templateType = detectTemplateType(fullPath);

      if (hasGit || templateType !== null) {
        // Root standalone project
        targets.push({
          fullPath,
          isThrowaway: false,
        });
      } else {
        // Group container: scan 1-level subdirectories
        let childEntries: fs.Dirent[] = [];
        try {
          childEntries = fs.readdirSync(fullPath, { withFileTypes: true });
        } catch {
          childEntries = [];
        }

        for (const child of childEntries) {
          if (!child.isDirectory() && !child.isSymbolicLink()) continue;
          if (child.name.startsWith('.')) continue;
          if (RESERVED_FOLDER_NAMES.has(child.name)) continue;

          const childPath = path.join(fullPath, child.name);
          targets.push({
            fullPath: childPath,
            group: entry.name,
            isThrowaway: false,
          });
        }
      }
    }
  }

  // 2. Scan throwawaysRoot if includeThrowaways !== false and throwaways directory exists
  const includeThrowaways = options?.includeThrowaways !== false;
  if (includeThrowaways && fs.existsSync(resolvedThrowawaysRoot)) {
    let throwawayEntries: fs.Dirent[] = [];
    try {
      throwawayEntries = fs.readdirSync(resolvedThrowawaysRoot, { withFileTypes: true });
    } catch {
      throwawayEntries = [];
    }

    for (const entry of throwawayEntries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue;
      if (RESERVED_FOLDER_NAMES.has(entry.name)) continue;

      const fullPath = path.join(resolvedThrowawaysRoot, entry.name);
      targets.push({
        fullPath,
        isThrowaway: true,
      });
    }
  }

  // Inspect all discovered targets concurrently with bounded parallelism
  const results = await mapConcurrent(targets, 8, (target) =>
    inspectProject(target.fullPath, {
      isThrowaway: target.isThrowaway,
      group: target.group,
      configDir: options?.configDir,
      now: options?.now,
    })
  );

  return results.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

/**
 * Scans canonical projects directory for 1-level group subfolders and returns structured GroupInfo list.
 */
export async function listGroups(
  canonicalRoot: string,
  options?: DiscoveryOptions
): Promise<GroupInfo[]> {
  const resolvedCanonicalRoot = path.resolve(canonicalRoot);
  let resolvedThrowawaysRoot: string;
  if (options?.throwawaysRoot) {
    resolvedThrowawaysRoot = path.resolve(options.throwawaysRoot);
  } else if (options?.configDir) {
    try {
      const config = getConfig({ configDir: options.configDir });
      resolvedThrowawaysRoot = config.throwawaysRoot
        ? path.resolve(config.throwawaysRoot)
        : path.join(resolvedCanonicalRoot, 'throwaways');
    } catch {
      resolvedThrowawaysRoot = path.join(resolvedCanonicalRoot, 'throwaways');
    }
  } else {
    resolvedThrowawaysRoot = path.join(resolvedCanonicalRoot, 'throwaways');
  }

  if (!fs.existsSync(resolvedCanonicalRoot)) {
    return [];
  }

  const groups: GroupInfo[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(resolvedCanonicalRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    if (RESERVED_FOLDER_NAMES.has(entry.name)) continue;

    const fullPath = path.join(resolvedCanonicalRoot, entry.name);
    if (path.resolve(fullPath) === resolvedThrowawaysRoot) {
      continue;
    }

    const hasGit = fs.existsSync(path.join(fullPath, '.git'));
    const templateType = detectTemplateType(fullPath);

    // If it has .git or template markers, it is a root project, not a group container
    if (hasGit || templateType !== null) {
      continue;
    }

    let childEntries: fs.Dirent[] = [];
    try {
      childEntries = fs.readdirSync(fullPath, { withFileTypes: true });
    } catch {
      childEntries = [];
    }

    const childTargets: string[] = [];
    for (const child of childEntries) {
      if (!child.isDirectory() && !child.isSymbolicLink()) continue;
      if (child.name.startsWith('.')) continue;
      if (RESERVED_FOLDER_NAMES.has(child.name)) continue;

      childTargets.push(path.join(fullPath, child.name));
    }

    const childProjects = await mapConcurrent(childTargets, 8, (childPath) =>
      inspectProject(childPath, {
        group: entry.name,
        isThrowaway: false,
        configDir: options?.configDir,
        now: options?.now,
      })
    );

    childProjects.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

    groups.push({
      name: entry.name,
      path: path.resolve(fullPath),
      projectCount: childProjects.length,
      projects: childProjects,
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves a project or group path deterministically from relative path, standalone name, or group directory.
 */
export async function resolveProject(
  nameOrPath: string,
  canonicalRoot: string,
  options?: DiscoveryOptions
): Promise<ResolveProjectResult> {
  const trimmed = nameOrPath ? nameOrPath.trim() : '';
  if (!trimmed) {
    return {
      resolved: false,
      targetPath: null,
      isAmbiguous: false,
      ambiguousMatches: [],
    };
  }

  const resolvedCanonicalRoot = path.resolve(canonicalRoot);
  let resolvedThrowawaysRoot: string;
  if (options?.throwawaysRoot) {
    resolvedThrowawaysRoot = path.resolve(options.throwawaysRoot);
  } else if (options?.configDir) {
    try {
      const config = getConfig({ configDir: options.configDir });
      resolvedThrowawaysRoot = config.throwawaysRoot
        ? path.resolve(config.throwawaysRoot)
        : path.join(resolvedCanonicalRoot, 'throwaways');
    } catch {
      resolvedThrowawaysRoot = path.join(resolvedCanonicalRoot, 'throwaways');
    }
  } else {
    resolvedThrowawaysRoot = path.join(resolvedCanonicalRoot, 'throwaways');
  }

  // 1. Direct absolute path check
  if (path.isAbsolute(trimmed)) {
    const resolvedPath = path.resolve(trimmed);
    if (fs.existsSync(resolvedPath)) {
      const isThrowaway = path.resolve(resolvedPath).startsWith(resolvedThrowawaysRoot);
      const isUnderCanonical = path.resolve(resolvedPath).startsWith(resolvedCanonicalRoot);

      // Check if it is a group directory directly under canonicalRoot
      if (isUnderCanonical && !isThrowaway) {
        const rel = path.relative(resolvedCanonicalRoot, resolvedPath);
        const parts = rel.split(path.sep).filter(Boolean);
        if (parts.length === 1 && !RESERVED_FOLDER_NAMES.has(parts[0])) {
          const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
          const templateType = detectTemplateType(resolvedPath);
          if (!hasGit && templateType === null) {
            const allGroups = await listGroups(resolvedCanonicalRoot, options);
            const matchedGroup = allGroups.find(
              (g) => path.resolve(g.path) === resolvedPath
            );
            if (matchedGroup) {
              return {
                resolved: true,
                targetPath: resolvedPath,
                type: 'group',
                group: matchedGroup,
                isAmbiguous: false,
                ambiguousMatches: [],
              };
            }
          }
        }
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        const group = isUnderCanonical && !isThrowaway
          ? (() => {
              const rel = path.relative(resolvedCanonicalRoot, resolvedPath);
              const parts = rel.split(path.sep).filter(Boolean);
              return parts.length > 1 ? parts[0] : undefined;
            })()
          : undefined;

        const info = await inspectProject(resolvedPath, {
          isThrowaway,
          ...(group ? { group } : {}),
          configDir: options?.configDir,
          now: options?.now,
        });

        return {
          resolved: true,
          targetPath: resolvedPath,
          type: isThrowaway ? 'throwaway' : 'project',
          project: info,
          isAmbiguous: false,
          ambiguousMatches: [],
        };
      }
    }
  }

  // Normalize slashes for relative path analysis
  const normalized = trimmed.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  // 2. Check 2-segment path (e.g. hackathons/bot or throwaways/scratch-1)
  if (segments.length === 2) {
    const [firstSegment, secondSegment] = segments;

    // Check if in throwaways
    if (firstSegment === 'throwaways' || firstSegment === path.basename(resolvedThrowawaysRoot)) {
      const throwawayCandidate = path.join(resolvedThrowawaysRoot, secondSegment);
      if (fs.existsSync(throwawayCandidate)) {
        const info = await inspectProject(throwawayCandidate, {
          isThrowaway: true,
          configDir: options?.configDir,
          now: options?.now,
        });
        return {
          resolved: true,
          targetPath: path.resolve(throwawayCandidate),
          type: 'throwaway',
          project: info,
          isAmbiguous: false,
          ambiguousMatches: [],
        };
      }
    }

    // Check if in group under canonicalRoot
    const groupCandidate = path.join(resolvedCanonicalRoot, firstSegment, secondSegment);
    if (fs.existsSync(groupCandidate)) {
      const info = await inspectProject(groupCandidate, {
        group: firstSegment,
        isThrowaway: false,
        configDir: options?.configDir,
        now: options?.now,
      });
      return {
        resolved: true,
        targetPath: path.resolve(groupCandidate),
        type: 'project',
        project: info,
        isAmbiguous: false,
        ambiguousMatches: [],
      };
    }
  }

  // 3. Search across workspace for matching standalone name (without inspecting unrelated projects)
  interface CandidateTarget {
    path: string;
    isThrowaway: boolean;
    group?: string;
  }
  const candidateTargets: CandidateTarget[] = [];

  // Check root standalone project
  const rootCandidate = path.join(resolvedCanonicalRoot, trimmed);
  if (
    fs.existsSync(rootCandidate) &&
    !RESERVED_FOLDER_NAMES.has(trimmed) &&
    path.resolve(rootCandidate) !== resolvedThrowawaysRoot
  ) {
    const stat = fs.statSync(rootCandidate);
    if (stat.isDirectory()) {
      const hasGit = fs.existsSync(path.join(rootCandidate, '.git'));
      const templateType = detectTemplateType(rootCandidate);
      if (hasGit || templateType !== null) {
        candidateTargets.push({
          path: path.resolve(rootCandidate),
          isThrowaway: false,
        });
      }
    }
  }

  // Check 1-level groups for a matching child project
  if (fs.existsSync(resolvedCanonicalRoot)) {
    let groupEntries: fs.Dirent[] = [];
    try {
      groupEntries = fs.readdirSync(resolvedCanonicalRoot, { withFileTypes: true });
    } catch {
      groupEntries = [];
    }
    for (const groupEntry of groupEntries) {
      if (!groupEntry.isDirectory() && !groupEntry.isSymbolicLink()) continue;
      if (groupEntry.name.startsWith('.')) continue;
      if (RESERVED_FOLDER_NAMES.has(groupEntry.name)) continue;

      const groupPath = path.join(resolvedCanonicalRoot, groupEntry.name);
      if (path.resolve(groupPath) === resolvedThrowawaysRoot) continue;

      const hasGit = fs.existsSync(path.join(groupPath, '.git'));
      const templateType = detectTemplateType(groupPath);
      if (!hasGit && templateType === null) {
        const childCandidate = path.join(groupPath, trimmed);
        if (fs.existsSync(childCandidate) && !RESERVED_FOLDER_NAMES.has(trimmed)) {
          const childStat = fs.statSync(childCandidate);
          if (childStat.isDirectory()) {
            candidateTargets.push({
              path: path.resolve(childCandidate),
              isThrowaway: false,
              group: groupEntry.name,
            });
          }
        }
      }
    }
  }

  // Check throwaways
  const includeThrowaways = options?.includeThrowaways !== false;
  if (includeThrowaways && fs.existsSync(resolvedThrowawaysRoot)) {
    const throwawayCandidate = path.join(resolvedThrowawaysRoot, trimmed);
    if (fs.existsSync(throwawayCandidate) && !RESERVED_FOLDER_NAMES.has(trimmed)) {
      const stat = fs.statSync(throwawayCandidate);
      if (stat.isDirectory()) {
        candidateTargets.push({
          path: path.resolve(throwawayCandidate),
          isThrowaway: true,
        });
      }
    }
  }

  if (candidateTargets.length === 1) {
    const target = candidateTargets[0];
    const info = await inspectProject(target.path, {
      isThrowaway: target.isThrowaway,
      group: target.group,
      configDir: options?.configDir,
      now: options?.now,
    });
    return {
      resolved: true,
      targetPath: info.path,
      type: info.isThrowaway ? 'throwaway' : 'project',
      project: info,
      isAmbiguous: false,
      ambiguousMatches: [],
    };
  } else if (candidateTargets.length > 1) {
    const matchingProjects = await mapConcurrent(candidateTargets, 8, (target) =>
      inspectProject(target.path, {
        isThrowaway: target.isThrowaway,
        group: target.group,
        configDir: options?.configDir,
        now: options?.now,
      })
    );
    return {
      resolved: false,
      targetPath: null,
      isAmbiguous: true,
      ambiguousMatches: matchingProjects,
    };
  }

  // 4. Check if trimmed name matches a group folder name
  const groupCandidatePath = path.join(resolvedCanonicalRoot, trimmed);
  if (
    fs.existsSync(groupCandidatePath) &&
    !RESERVED_FOLDER_NAMES.has(trimmed) &&
    path.resolve(groupCandidatePath) !== resolvedThrowawaysRoot
  ) {
    const stat = fs.statSync(groupCandidatePath);
    if (stat.isDirectory()) {
      const hasGit = fs.existsSync(path.join(groupCandidatePath, '.git'));
      const templateType = detectTemplateType(groupCandidatePath);
      if (!hasGit && templateType === null) {
        const allGroups = await listGroups(resolvedCanonicalRoot, options);
        const matchingGroup = allGroups.find((g) => g.name === trimmed);
        if (matchingGroup) {
          return {
            resolved: true,
            targetPath: matchingGroup.path,
            type: 'group',
            group: matchingGroup,
            isAmbiguous: false,
            ambiguousMatches: [],
          };
        }
      }
    }
  }

  // 5. Fallback check for direct directories under canonicalRoot, throwawaysRoot, or relative to cwd
  const fallbackRootCandidate = path.join(resolvedCanonicalRoot, trimmed);
  if (fs.existsSync(fallbackRootCandidate) && fs.statSync(fallbackRootCandidate).isDirectory()) {
    return {
      resolved: true,
      targetPath: path.resolve(fallbackRootCandidate),
      type: 'directory',
      isAmbiguous: false,
      ambiguousMatches: [],
    };
  }

  const fallbackThrowawayCandidate = path.join(resolvedThrowawaysRoot, trimmed);
  if (fs.existsSync(fallbackThrowawayCandidate) && fs.statSync(fallbackThrowawayCandidate).isDirectory()) {
    const info = await inspectProject(fallbackThrowawayCandidate, {
      isThrowaway: true,
      configDir: options?.configDir,
      now: options?.now,
    });
    return {
      resolved: true,
      targetPath: path.resolve(fallbackThrowawayCandidate),
      type: 'throwaway',
      project: info,
      isAmbiguous: false,
      ambiguousMatches: [],
    };
  }

  const cwdCandidate = path.resolve(trimmed);
  if (fs.existsSync(cwdCandidate) && fs.statSync(cwdCandidate).isDirectory()) {
    return {
      resolved: true,
      targetPath: cwdCandidate,
      type: 'directory',
      isAmbiguous: false,
      ambiguousMatches: [],
    };
  }

  return {
    resolved: false,
    targetPath: null,
    isAmbiguous: false,
    ambiguousMatches: [],
  };
}

/**
 * Formats projects list as JSON string.
 */
export function formatProjectsJson(projects: ProjectInfo[]): string {
  return JSON.stringify(projects, null, 2);
}

export function formatProjectsTable(projects: ProjectInfo[]): string {
  if (projects.length === 0) {
    return 'No projects found.';
  }

  const rows = projects.map((p) => {
    let displayName = p.name;
    if (p.isThrowaway) {
      displayName = p.isExpired ? `${p.name} (throwaway: expired)` : `${p.name} (throwaway)`;
    }
    const branch = p.isGit ? p.branch || 'HEAD' : '-';
    const status = p.isGit
      ? p.dirtyCount === 0
        ? 'clean'
        : `${p.dirtyCount} dirty`
      : 'non-git';
    const badge = p.templateBadge;
    const dateStr =
      p.lastModified.getTime() === 0
        ? '-'
        : p.lastModified.toISOString().replace('T', ' ').slice(0, 16);

    return {
      name: displayName,
      badge,
      branch,
      status,
      date: dateStr,
      path: p.path,
      group: p.group,
      isThrowaway: p.isThrowaway,
    };
  });

  // Calculate column widths
  const colName = Math.max(4, ...rows.map((r) => r.name.length));
  const colBadge = Math.max(8, ...rows.map((r) => r.badge.length));
  const colBranch = Math.max(6, ...rows.map((r) => r.branch.length));
  const colStatus = Math.max(6, ...rows.map((r) => r.status.length));
  const colDate = Math.max(16, ...rows.map((r) => r.date.length));

  const pad = (str: string, width: number) => str.padEnd(width, ' ');

  const header = `${pad('NAME', colName)}  ${pad('TEMPLATE', colBadge)}  ${pad('BRANCH', colBranch)}  ${pad('STATUS', colStatus)}  ${pad('LAST MODIFIED', colDate)}  PATH`;
  const separator = `${'-'.repeat(colName)}  ${'-'.repeat(colBadge)}  ${'-'.repeat(colBranch)}  ${'-'.repeat(colStatus)}  ${'-'.repeat(colDate)}  ${'-'.repeat(4)}`;

  // Organize rows by section:
  // 1. Grouped projects (sorted alphabetically by group name)
  // 2. Root standalone projects ([root])
  // 3. Throwaway scratchpads ([throwaways])
  const sections: { title: string; rows: typeof rows }[] = [];

  const groupsMap = new Map<string, typeof rows>();
  const rootRows: typeof rows = [];
  const throwawayRows: typeof rows = [];

  for (const r of rows) {
    if (r.isThrowaway) {
      throwawayRows.push(r);
    } else if (r.group) {
      if (!groupsMap.has(r.group)) {
        groupsMap.set(r.group, []);
      }
      groupsMap.get(r.group)!.push(r);
    } else {
      rootRows.push(r);
    }
  }

  const sortedGroups = Array.from(groupsMap.keys()).sort((a, b) => a.localeCompare(b));
  for (const g of sortedGroups) {
    sections.push({
      title: `[${g}]`,
      rows: groupsMap.get(g)!,
    });
  }

  if (rootRows.length > 0) {
    sections.push({
      title: '[root]',
      rows: rootRows,
    });
  }

  if (throwawayRows.length > 0) {
    sections.push({
      title: '[throwaways]',
      rows: throwawayRows,
    });
  }

  const lines = [header, separator];

  for (let i = 0; i < sections.length; i++) {
    if (i > 0) {
      lines.push('');
    }
    const sec = sections[i];
    lines.push(sec.title);
    for (const r of sec.rows) {
      lines.push(
        `${pad(r.name, colName)}  ${pad(r.badge, colBadge)}  ${pad(r.branch, colBranch)}  ${pad(r.status, colStatus)}  ${pad(r.date, colDate)}  ${r.path}`
      );
    }
  }

  return lines.join('\n');
}
