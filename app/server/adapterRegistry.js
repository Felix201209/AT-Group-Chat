import { THINKING_LEVELS } from './roles.js';

export const ADAPTERS = [
  {
    id: 'codex-app-server',
    label: 'Codex App Server',
    cli: 'codex',
    transport: 'websocket-jsonrpc',
    memory: 'native-thread',
    models: 'any Codex-supported model string',
    permissions: ['readonly', 'write-proposed', 'workspace-write', 'danger'],
    requiresCommandTemplate: false,
    description: 'Codex roles run through the long-lived local app-server. No codex exec path is used.'
  },
  {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    cli: 'claude',
    transport: 'process',
    memory: 'native-session-id',
    models: 'any Claude Code configured model, default deepseek-v4-pro',
    permissions: ['readonly', 'workspace-write', 'danger'],
    requiresCommandTemplate: false,
    description: 'Claude Code adapter for deep code review roles.'
  },
  {
    id: 'kimi-cli',
    label: 'Kimi Code CLI',
    cli: 'kimi',
    transport: 'process',
    memory: 'native-session-id',
    models: 'any Kimi CLI configured model',
    permissions: ['readonly', 'workspace-write', 'danger'],
    requiresCommandTemplate: false,
    description: 'Kimi CLI adapter for interaction and UI/UX review roles.'
  },
  {
    id: 'generic-cli',
    label: 'Generic Local CLI',
    cli: 'generic',
    transport: 'process-template',
    memory: 'AT_AGENT_SESSION_ID',
    models: 'any local or remote model reachable by the command template',
    permissions: ['readonly', 'write-proposed', 'workspace-write', 'danger'],
    requiresCommandTemplate: true,
    description: 'Universal adapter. The runtime writes the role prompt to AT_AGENT_PROMPT_FILE and passes model/session/project env vars.'
  },
  {
    id: 'event-test',
    label: 'Event Test Adapter',
    cli: 'generic',
    transport: 'mock-only',
    memory: 'synthetic',
    models: 'test',
    permissions: ['readonly', 'write-proposed'],
    requiresCommandTemplate: true,
    hidden: true,
    description: 'Internal test adapter used to verify runtime event visibility.'
  }
];

const ADAPTER_BY_ID = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function listAdapters() {
  return ADAPTERS.filter((adapter) => !adapter.hidden);
}

export function getAdapter(adapterId) {
  return ADAPTER_BY_ID.get(adapterId) || null;
}

export function adapterExists(adapterId) {
  return ADAPTER_BY_ID.has(adapterId);
}

export function validateAgentDefinition(agent) {
  const failures = [];
  if (!agent.roleId && !agent.role_id) failures.push('roleId is required');
  const roleId = agent.roleId || agent.role_id;
  if (roleId && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(roleId)) {
    failures.push('roleId must be 2-63 chars, lowercase letters, numbers, and dashes');
  }

  const adapterId = agent.adapter || agent.cli || 'generic-cli';
  const adapter = getAdapter(adapterId);
  if (!adapter) failures.push(`unsupported adapter: ${adapterId}`);

  if (adapter?.requiresCommandTemplate && !String(agent.commandTemplate || agent.command_template || '').trim()) {
    failures.push(`adapter ${adapter.id} requires commandTemplate`);
  }
  const thinkingLevel = agent.thinkingLevel || agent.thinking_level;
  if (thinkingLevel && !THINKING_LEVELS.includes(thinkingLevel)) {
    failures.push(`unsupported thinkingLevel: ${thinkingLevel}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    adapter
  };
}
