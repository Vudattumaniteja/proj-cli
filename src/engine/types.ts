export interface ProjectInfo {
  name: string;
  path: string;
  isGit: boolean;
  branch: string | null;
  dirtyCount: number;
  isDirty: boolean;
  templateType: string | null;
  templateBadge: string;
  lastModified: Date;
  isThrowaway: boolean;
  expiresAt?: string;
  isExpired?: boolean;
}

export type ProjectTemplate = 'minimal' | 'typescript' | 'python' | 'web';

export const SUPPORTED_TEMPLATES: readonly ProjectTemplate[] = [
  'minimal',
  'typescript',
  'python',
  'web',
] as const;

export interface ScaffoldOptions {
  parentDir?: string;
  configDir?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
}

export interface ScaffoldResult {
  name: string;
  path: string;
  template: ProjectTemplate;
  commitHash: string;
  files: string[];
}

export interface DiscoveryOptions {
  throwawaysRoot?: string;
  includeThrowaways?: boolean;
  configDir?: string;
  now?: Date | string | number;
}

export interface FormatOptions {
  json?: boolean;
  colors?: boolean;
}

export type { ThrowawayRecord } from '../config/types.js';

export interface ThrowawayOptions {
  configDir?: string;
  throwawaysRoot?: string;
  now?: Date | string | number;
}

export interface GraduateOptions {
  configDir?: string;
  projectsRoot?: string;
  throwawaysRoot?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
}

export interface GraduateResult {
  name: string;
  path: string;
  previousPath: string;
  isGit: boolean;
  commitHash?: string;
}

export interface DeleteThrowawayResult {
  name: string;
  path: string;
  deleted: boolean;
}

export interface CheckpointOptions {
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  allowEmpty?: boolean;
}

export interface CheckpointResult {
  hash: string;
  shortHash: string;
  message: string;
  timestamp: Date;
  filesChanged: number;
}

export interface CheckpointInfo {
  hash: string;
  shortHash: string;
  message: string;
  date: Date;
  timestamp: Date;
  relativeTimestamp: string;
  relativeTime: string;
  authorName?: string;
  authorEmail?: string;
}

export interface RollbackOptions {
  force?: boolean;
}

export interface RollbackResult {
  success: boolean;
  targetHash: string;
  targetShortHash: string;
  targetMessage: string;
  stashCreated: boolean;
  stashName: string | null;
  stashRef: string | null;
  revertedFiles: string[];
  summary: string;
}

export interface AdoptOptions {
  configDir?: string;
  projectsRoot?: string;
  name?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
}

export interface AdoptResult {
  name: string;
  path: string;
  previousPath: string;
  isGit: boolean;
  commitHash?: string;
}

