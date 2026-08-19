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

export interface DiscoveryOptions {
  throwawaysRoot?: string;
  includeThrowaways?: boolean;
}

export interface FormatOptions {
  json?: boolean;
  colors?: boolean;
}
