import { Brain, CheckCircle2, Code2, MessageSquare } from 'lucide-react';
import { MANAGER_ROLE_ID } from './constants.js';

export const permissionLabels = {
  readonly: '只读',
  'write-proposed': '建议写入',
  'workspace-write': '可写',
  danger: '危险'
};

export const thinkingLabels = {
  default: '默认',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高'
};

export const roleIcons = {
  [MANAGER_ROLE_ID]: Brain,
  'claude-deep-review': Code2,
  'kimi-ux-review': MessageSquare,
  'codex-goal-review': CheckCircle2
};

export const workTypeLabels = {
  issue: 'Issue',
  proposal: 'Proposal / PR',
  review: 'Review',
  decision: 'Decision',
  artifact: 'Artifact'
};

export const workStatusLabels = {
  open: 'Open',
  'in-progress': 'In Progress',
  review: 'Review',
  accepted: 'Accepted',
  closed: 'Closed'
};

export const workPriorityLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent'
};

export const storageKeys = {
  activeRunId: 'at.activeRunId',
  chatShowSystemEvents: 'at.chat.showSystemEvents',
  theme: 'at.theme'
};
