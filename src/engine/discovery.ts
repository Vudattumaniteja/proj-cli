import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { getConfig } from '../config/index.js';
import type { ProjectInfo, DiscoveryOptions } from './types.js';

export * from './types.js';

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
 * Returns formatted template badge string (e.g. `[typescript]`).
 */
export function getTemplateBadge(templateType: string | null): string {
  if (!templateType) {
    return '[unknown]';
  }
  return `[${templateType}]`;
}

/**
 * Inspects a single project directory and extracts Git status, template type, and metadata.
 */
export async function inspectProject(
  projectPath: string,
  options?: { isThrowaway?: boolean; expiresAt?: string; isExpired?: boolean }
): Promise<ProjectInfo> {
  const resolvedPath = path.resolve(projectPath);
  const name = path.basename(resolvedPath);
  const isThrowaway = options?.isThrowaway ?? false;
  const expiresAt = options?.expiresAt;
  const isExpired = options?.isExpired;

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

  if (fs.existsSync(gitDir)) {
    try {
      const git = simpleGit(resolvedPath, { maxConcurrentProcesses: 2 });
      const isRepo = await git.checkIsRepo();
      if (isRepo) {
        isGit = true;
        const status = await git.status();
        branch = status.current || 'HEAD';
        dirtyCount = status.files.length;
      }
    } catch {
      // Gracefully handle git errors without crashing
      isGit = true;
      branch = null;
      dirtyCount = 0;
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
  };
}

/**
 * Scans the canonical projects directory and throwaways directory, returning structured ProjectInfo list.
 */
export async function listProjects(
  canonicalRoot: string,
  options?: DiscoveryOptions
): Promise<ProjectInfo[]> {
  const resolvedCanonicalRoot = path.resolve(canonicalRoot);
  const resolvedThrowawaysRoot = options?.throwawaysRoot
    ? path.resolve(options.throwawaysRoot)
    : path.join(resolvedCanonicalRoot, 'throwaways');

  const config = getConfig({ configDir: options?.configDir });
  const throwawaysMeta = config.throwaways || {};

  const results: ProjectInfo[] = [];

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

      const fullPath = path.join(resolvedCanonicalRoot, entry.name);

      // If this directory is the throwaways root, skip it as a regular project
      if (path.resolve(fullPath) === resolvedThrowawaysRoot || entry.name === 'throwaways') {
        continue;
      }

      const info = await inspectProject(fullPath, { isThrowaway: false });
      results.push(info);
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

      const fullPath = path.join(resolvedThrowawaysRoot, entry.name);
      const record = throwawaysMeta[entry.name];
      const isExpired = record
        ? Date.now() > new Date(record.expiresAt).getTime()
        : false;

      const info = await inspectProject(fullPath, {
        isThrowaway: true,
        expiresAt: record?.expiresAt,
        isExpired,
      });
      results.push(info);
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Formats projects list as JSON string.
 */
export function formatProjectsJson(projects: ProjectInfo[]): string {
  return JSON.stringify(projects, null, 2);
}

/**
 * Formats projects list as a clean non-interactive tabular string.
 */
export function formatProjectsTable(projects: ProjectInfo[]): string {
  if (projects.length === 0) {
    return 'No projects found.';
  }

  const rows = projects.map((p) => {
    const displayName = p.isThrowaway
      ? p.isExpired
        ? `${p.name} (throwaway: expired)`
        : `${p.name} (throwaway)`
      : p.name;
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

  const lines = [header, separator];
  for (const r of rows) {
    lines.push(
      `${pad(r.name, colName)}  ${pad(r.badge, colBadge)}  ${pad(r.branch, colBranch)}  ${pad(r.status, colStatus)}  ${pad(r.date, colDate)}  ${r.path}`
    );
  }

  return lines.join('\n');
}
