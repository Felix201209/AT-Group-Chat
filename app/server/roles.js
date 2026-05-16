import { GOAL_REVIEW_ROLE_ID, MANAGER_ROLE_ID } from './constants.js';

export const PERMISSION_PROFILES = ['readonly', 'write-proposed', 'workspace-write', 'danger'];
export const THINKING_LEVELS = ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export const ROLES = [
  {
    id: MANAGER_ROLE_ID,
    name: 'Team Manager',
    cli: 'codex',
    adapter: 'codex-app-server',
    command: 'codex',
    model: 'default',
    thinkingLevel: 'medium',
    accent: '#2563eb',
    mcpTool: 'team_create_task',
    defaultPermission: 'write-proposed',
    responsibility: '接收任务、拆分目标、调度岗位、开放权限、汇总结论。'
  },
  {
    id: 'claude-deep-review',
    name: 'Code Deep Review',
    cli: 'claude',
    adapter: 'claude-cli',
    command: 'claude',
    model: 'deepseek-v4-pro',
    thinkingLevel: 'high',
    accent: '#7c3aed',
    mcpTool: 'team_dispatch_agent',
    defaultPermission: 'readonly',
    responsibility: '使用 Claude Code 的 deepseek-v4-pro 模型做底层代码审查。'
  },
  {
    id: 'kimi-ux-review',
    name: 'User Interaction + UI/UX Review',
    cli: 'kimi',
    adapter: 'kimi-cli',
    command: 'kimi',
    model: 'kimi-code-cli',
    thinkingLevel: 'medium',
    accent: '#0891b2',
    mcpTool: 'team_dispatch_agent',
    defaultPermission: 'readonly',
    responsibility: '审查用户交互、信息架构、可用性、视觉和 UI/UX 体验。'
  },
  {
    id: GOAL_REVIEW_ROLE_ID,
    name: 'Plan Goal Check',
    cli: 'codex',
    adapter: 'codex-app-server',
    command: 'codex',
    model: 'default',
    thinkingLevel: 'high',
    accent: '#16a34a',
    mcpTool: 'team_get_status',
    defaultPermission: 'readonly',
    responsibility: '独立于 manager 的 Codex 会话，用于检查计划和目标是否被满足。'
  }
];

export function getRole(roleId) {
  const role = ROLES.find((item) => item.id === roleId);
  if (!role) throw new Error(`Unknown role: ${roleId}`);
  return role;
}

export function normalizePermissionProfile(value, fallback = 'readonly') {
  return PERMISSION_PROFILES.includes(value) ? value : fallback;
}

export function normalizeThinkingLevel(value, fallback = 'medium') {
  return THINKING_LEVELS.includes(value) ? value : fallback;
}
