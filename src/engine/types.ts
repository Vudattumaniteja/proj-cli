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
}

export interface FormatOptions {
  json?: boolean;
  colors?: boolean;
}
