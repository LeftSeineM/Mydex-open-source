export type JsonRpcId = number | string;
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export interface ConnectionProfile {
  id: string;
  name: string;
  apiBaseUrl: string;
  model: string;
  contextWindow: number;
  reasoningEffort: AgentSettings['reasoningEffort'];
  apiKeyConfigured: boolean;
}

export interface AgentSettings {
  localExecutable: string;
  cwd: string;
  model: string;
  sandbox: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  theme: 'system' | 'light' | 'dark';
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  activeProfileId: string;
  connectionProfiles: ConnectionProfile[];
  reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  contextWindow: number;
  projects: string[];
}

export interface ThreadItem {
  type: string;
  id?: string;
  text?: string;
  content?: Array<Record<string, unknown>>;
  summary?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface MydexTurn {
  id: string;
  status: string;
  items: ThreadItem[];
  error?: { message?: string } | null;
}

export interface MydexThread {
  id: string;
  sessionId?: string;
  preview: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: unknown;
  name: string | null;
  turns: MydexTurn[];
}

export interface MydexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault?: boolean;
}

export interface RpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

export interface ServerRequest {
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}
