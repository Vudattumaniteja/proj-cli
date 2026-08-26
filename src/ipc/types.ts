export type IpcAction = 'cd' | 'code' | 'none';

export interface IpcPayload {
  action: IpcAction;
  targetPath: string;
  timestamp: number;
}

export interface IpcOptions {
  configDir?: string;
}

export interface PowerShellWrapperOptions {
  functionName?: string;
  binName?: string;
  configDir?: string;
}

export interface CmdWrapperOptions {
  binName?: string;
  configDir?: string;
  isNpmShim?: boolean;
  targetJs?: string;
}
