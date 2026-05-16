export class ATClient {
  constructor({
    baseUrl = process.env.AT_TEAM_API_BASE_URL || 'http://127.0.0.1:5174',
    token = process.env.AT_TEAM_API_TOKEN || '',
    hookToken = process.env.AT_TEAM_HOOK_TOKEN || ''
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.hookToken = hookToken;
  }

  headers(extra = {}) {
    return {
      'content-type': 'application/json',
      ...(this.token ? { 'x-at-token': this.token } : {}),
      ...extra
    };
  }

  parseResponseText(text) {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async request(path, { method = 'GET', body, headers } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(headers),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const data = this.parseResponseText(text);
    if (!response.ok) {
      const error = new Error(data.error || `${response.status} ${response.statusText}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  parseSseRecord(record) {
    const lines = record.split(/\r?\n/);
    const event = { event: 'message', id: '', data: '' };
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      const index = line.indexOf(':');
      const field = index === -1 ? line : line.slice(0, index);
      const value = index === -1 ? '' : line.slice(index + 1).replace(/^ /, '');
      if (field === 'id') event.id = value;
      else if (field === 'event') event.event = value;
      else if (field === 'data') event.data += `${value}\n`;
    }
    event.data = event.data.replace(/\n$/, '');
    return event;
  }

  async *runEvents(runId, { after = 0, signal } = {}) {
    if (!runId) throw new Error('runId is required');
    const controller = signal ? null : new AbortController();
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    const response = await fetch(`${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/events${query}`, {
      headers: this.headers(),
      signal: signal || controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      const data = this.parseResponseText(text);
      const error = new Error(data.error || `${response.status} ${response.statusText}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error('SSE response body is not readable');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const records = buffer.split(/\r?\n\r?\n/);
        buffer = records.pop() || '';
        for (const record of records) {
          const parsed = this.parseSseRecord(record);
          if (!parsed.data) continue;
          yield JSON.parse(parsed.data);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        const parsed = this.parseSseRecord(buffer);
        if (parsed.data) yield JSON.parse(parsed.data);
      }
    } finally {
      reader.cancel?.().catch?.(() => {});
      reader.releaseLock?.();
      controller?.abort();
    }
  }

  status(projectId) {
    return this.request(projectId ? `/api/status?projectId=${encodeURIComponent(projectId)}` : '/api/status');
  }

  platform(projectId) {
    return this.request(projectId ? `/api/platform?projectId=${encodeURIComponent(projectId)}` : '/api/platform');
  }

  room(projectId) {
    return this.request(projectId ? `/api/chat?projectId=${encodeURIComponent(projectId)}` : '/api/chat');
  }

  chat({ projectId, title, content, permissionProfile = 'write-proposed' }) {
    return this.request('/api/chat/messages', {
      method: 'POST',
      body: { projectId, title, content, permissionProfile }
    });
  }

  createTask({ projectId, title, prompt, permissionProfile = 'write-proposed' }) {
    return this.request('/api/runs', {
      method: 'POST',
      body: { projectId, title, prompt, permissionProfile }
    });
  }

  dispatchAgent({ runId, roleId, task, permissionProfile = 'readonly' }) {
    return this.request(`/api/runs/${encodeURIComponent(runId)}/dispatch`, {
      method: 'POST',
      body: { roleId, task, permissionProfile }
    });
  }

  workItems(projectId) {
    return this.request(projectId ? `/api/work-items?projectId=${encodeURIComponent(projectId)}` : '/api/work-items');
  }

  createWorkItem(input) {
    return this.request('/api/work-items', { method: 'POST', body: input });
  }

  ingestEvent(input) {
    return this.request('/api/hooks/events', {
      method: 'POST',
      body: input,
      headers: this.hookToken ? { 'x-at-hook-token': this.hookToken } : undefined
    });
  }

  updateWorkItem(id, input) {
    return this.request(`/api/work-items/${encodeURIComponent(id)}`, { method: 'POST', body: input });
  }

  workItemActivity(id, projectId) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return this.request(`/api/work-items/${encodeURIComponent(id)}/activity${query}`);
  }

  dispatchWorkItem(id, input = {}) {
    return this.request(`/api/work-items/${encodeURIComponent(id)}/dispatch`, { method: 'POST', body: input });
  }

  configureAgent(roleId, config) {
    return this.request(`/api/agents/${encodeURIComponent(roleId)}/config`, { method: 'POST', body: config });
  }

  applyManifest(manifest, projectId) {
    return this.request('/api/team/manifest', { method: 'POST', body: { projectId, manifest } });
  }

  setPermission(roleId, { projectId, permissionProfile }) {
    return this.request(`/api/agents/${encodeURIComponent(roleId)}/permissions`, {
      method: 'POST',
      body: { projectId, permissionProfile }
    });
  }

  memory(roleId, projectId) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return this.request(`/api/agents/${encodeURIComponent(roleId)}/memory${query}`);
  }

  openApi() {
    return this.request('/api/openapi.json');
  }

  contract() {
    return this.request('/api/contract');
  }
}

export function createATClient(options) {
  return new ATClient(options);
}
