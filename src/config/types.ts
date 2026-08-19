export interface ProjConfig {
  projectsRoot: string;
  throwawaysRoot: string;
  desktopJunctionPath?: string;
  defaultTtlDays?: number;
  [key: string]: unknown;
}

export interface ConfigOptions {
  configDir?: string;
}
