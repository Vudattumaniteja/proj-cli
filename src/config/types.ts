export interface ThrowawayRecord {
  name: string;
  path: string;
  createdAt: string;
  expiresAt: string;
  ttlDays: number;
  template?: string;
}

export interface ProjConfig {
  projectsRoot: string;
  throwawaysRoot: string;
  desktopJunctionPath?: string;
  defaultTtlDays?: number;
  throwaways?: Record<string, ThrowawayRecord>;
  [key: string]: unknown;
}

export interface ConfigOptions {
  configDir?: string;
}

