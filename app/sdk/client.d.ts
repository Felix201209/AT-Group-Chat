export type PermissionProfile = 'readonly' | 'write-proposed' | 'workspace-write' | 'danger';
export type WorkItemType = 'issue' | 'proposal' | 'review' | 'decision' | 'artifact';
export type WorkItemStatus = 'open' | 'in-progress' | 'review' | 'accepted' | 'closed';

export interface ATClientOptions {
  baseUrl?: string;
  token?: string;
  hookToken?: string;
}

export interface ChatInput {
  projectId?: string;
  title?: string;
  content: string;
  permissionProfile?: PermissionProfile;
}

export interface TaskInput {
  projectId?: string;
  title?: string;
  prompt: string;
  permissionProfile?: PermissionProfile;
}

export interface DispatchAgentInput {
  runId: string;
  roleId: string;
  task: string;
  permissionProfile?: PermissionProfile;
}

export interface WorkItemInput {
  projectId?: string;
  type?: WorkItemType;
  title: string;
  body?: string;
  status?: WorkItemStatus;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignedRoleId?: string;
  linkedRunId?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  dispatchToManager?: boolean;
  permissionProfile?: PermissionProfile;
}

export interface DeveloperEventInput extends Omit<WorkItemInput, 'title'> {
  source?: string;
  event?: string;
  title: string;
  dedupeKey?: string;
  deliveryId?: string;
  idempotencyKey?: string;
}

export interface AgentConfigInput {
  name?: string;
  cli?: string;
  adapter?: string;
  command?: string;
  commandTemplate?: string;
  model?: string;
  thinkingLevel?: 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  responsibility?: string;
  defaultPermission?: PermissionProfile;
}

export interface TeamManifest {
  name?: string;
  version?: string;
  projectId?: string;
  defaults?: AgentConfigInput & { roleIds?: string[] };
  agents?: Array<AgentConfigInput & { roleId: string; dangerousCommandTemplate?: boolean }>;
  workItems?: WorkItemInput[];
}

export class ATClient {
  constructor(options?: ATClientOptions);
  status(projectId?: string): Promise<any>;
  platform(projectId?: string): Promise<any>;
  room(projectId?: string): Promise<any>;
  chat(input: ChatInput): Promise<any>;
  createTask(input: TaskInput): Promise<any>;
  dispatchAgent(input: DispatchAgentInput): Promise<any>;
  workItems(projectId?: string): Promise<any>;
  createWorkItem(input: WorkItemInput): Promise<any>;
  ingestEvent(input: DeveloperEventInput): Promise<any>;
  updateWorkItem(id: string, input: Partial<WorkItemInput>): Promise<any>;
  workItemActivity(id: string, projectId?: string): Promise<any>;
  dispatchWorkItem(id: string, input?: { projectId?: string; prompt?: string; permissionProfile?: PermissionProfile }): Promise<any>;
  configureAgent(roleId: string, config: AgentConfigInput): Promise<any>;
  applyManifest(manifest: TeamManifest, projectId?: string): Promise<any>;
  setPermission(roleId: string, input: { projectId?: string; permissionProfile: PermissionProfile }): Promise<any>;
  memory(roleId: string, projectId?: string): Promise<any>;
  runEvents(runId: string, options?: { after?: number; signal?: AbortSignal }): AsyncGenerator<any, void, unknown>;
  openApi(): Promise<any>;
  contract(): Promise<any>;
}

export function createATClient(options?: ATClientOptions): ATClient;
