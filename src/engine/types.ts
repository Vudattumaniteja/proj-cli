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
  hasRemote: boolean;
  remoteUrl?: string;
  githubRepo?: {
    owner: string;
    repo: string;
    webUrl: string;
  };
  group?: string;
}

export interface GroupInfo {
  name: string;
  path: string;
  projectCount: number;
  projects: ProjectInfo[];
}

export type ResolvedTargetType = 'project' | 'group' | 'throwaway' | 'directory';

export interface ResolveProjectResult {
  resolved: boolean;
  targetPath: string | null;
  type?: ResolvedTargetType;
  project?: ProjectInfo;
  group?: GroupInfo;
  isAmbiguous: boolean;
  ambiguousMatches: ProjectInfo[];
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
  group?: string;
}

export interface ScaffoldResult {
  name: string;
  group?: string;
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

export interface PublishOptions {
  configDir?: string;
  projectsRoot?: string;
  throwawaysRoot?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  repoName?: string;
}

export interface PublishResult {
  name: string;
  path: string;
  repoUrl: string;
  isPrivate: boolean;
}

export interface DeleteProjectOptions {
  cloud?: boolean;
  force?: boolean;
  configDir?: string;
  projectsRoot?: string;
  throwawaysRoot?: string;
}

export interface DeleteProjectResult {
  name: string;
  path: string;
  cloudDeleted: boolean;
  groupPruned?: boolean;
  prunedGroup?: string;
}

export interface OrganizeOptions {
  configDir?: string;
  projectsRoot?: string;
  throwawaysRoot?: string;
}

export interface MoveProjectResult {
  name: string;
  path: string;
  previousPath: string;
  group?: string;
  previousGroup?: string;
}

export interface DeleteGroupOptions {
  force?: boolean;
  configDir?: string;
  projectsRoot?: string;
}

export interface DeleteGroupResult {
  name: string;
  path: string;
  deleted: boolean;
}

