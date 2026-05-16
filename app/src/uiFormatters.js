export function readStoredValue(key, fallback = null) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredValue(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Local storage is a convenience only; runtime state still works without it.
  }
}

export function formatTime(value) {
  if (value == null) return '刚刚';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '刚刚';
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(d);
  } catch {
    return '刚刚';
  }
}

export function formatDateTime(value) {
  if (value == null) return '时间未知';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
      timeZoneName: 'short'
    }).format(d);
  } catch {
    return '时间未知';
  }
}

export function compactText(value, limit = 140) {
  if (!value) return '';
  const text = String(value).trim();
  if (text.length <= limit) return text;
  const hasStructuredLines = text.includes('\n') || text.includes('```');
  if (hasStructuredLines) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const preview = lines.slice(0, 4).join('\n');
    return preview.length > limit ? `${preview.slice(0, limit - 1)}...` : preview;
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

export function eventChatText(event, payload) {
  if (event.type === 'run.created') return payload.prompt || payload.run?.title || '创建了一个 manager task';
  if (event.type === 'agent.queued') return `Manager 点名 ${payload.roleId || event.role_id || 'agent'}`;
  if (event.type === 'agent.started') return '开始处理';
  if (event.type === 'agent.permission.requested') {
    return `权限请求: ${payload.method || 'request'}，自动处理: ${payload.autoResponse || '已记录'}`;
  }
  if (event.type === 'agent.approval.requested') {
    return `Approval 请求: ${payload.method || 'request'}，自动处理: ${payload.autoResponse || '已记录'}`;
  }
  if (event.type === 'permission.updated') return `权限闸门更新为 ${payload.permissionProfile}`;
  if (event.type === 'agent.failed') return payload.error || payload.output || '执行失败';
  return payload.output || payload.task || payload.message || payload.prompt || event.payload;
}

export function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return { output: String(payload) };
  }
}
