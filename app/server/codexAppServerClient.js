import { CODEX_APP_SERVER_URL, ensureCodexCliServer } from './codexCliServer.js';
import { AT_PACKAGE_VERSION } from './packageInfo.js';

const DEFAULT_TIMEOUT_MS = 180000;

function createRpcClient({ url = CODEX_APP_SERVER_URL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  const ws = new WebSocket(url);

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), 8000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`Unable to connect to ${url}`));
    }, { once: true });
  });

  ws.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data.toString());
    } catch {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else entry.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  ws.addEventListener('close', () => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`Codex app-server connection closed before response ${id}`));
    }
    pending.clear();
  });

  async function request(method, params) {
    await opened;
    const id = nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function onNotification(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function respond(id, result) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id, result }));
  }

  function close() {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  }

  return { request, onNotification, respond, close };
}

function sandboxForPermission(permissionProfile) {
  if (permissionProfile === 'danger') return 'danger-full-access';
  if (permissionProfile === 'workspace-write' || permissionProfile === 'write-proposed') return 'workspace-write';
  return 'read-only';
}

function approvalForPermission(permissionProfile) {
  if (permissionProfile === 'write-proposed') return 'on-request';
  return 'never';
}

function reasoningEffortForRole(role) {
  if (!role.thinkingLevel || role.thinkingLevel === 'default') return undefined;
  return role.thinkingLevel;
}

function turnSandboxForPermission(permissionProfile, projectPath) {
  if (permissionProfile === 'danger') return { type: 'dangerFullAccess' };
  if (permissionProfile === 'workspace-write' || permissionProfile === 'write-proposed') {
    return {
      type: 'workspaceWrite',
      writableRoots: [projectPath],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    };
  }
  return { type: 'readOnly', networkAccess: true };
}

export function buildCodexAppServerStartParams({ role, projectPath, permissionProfile }) {
  const reasoningEffort = reasoningEffortForRole(role);
  return {
    model: role.model && role.model !== 'default' ? role.model : null,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    cwd: projectPath,
    approvalPolicy: approvalForPermission(permissionProfile),
    sandbox: sandboxForPermission(permissionProfile),
    serviceName: role.id,
    baseInstructions: role.responsibility,
    developerInstructions: '你是 AT Agent Team 的一个岗位。只在 manager 点名时回复；不要主动触发其他 agent；不要无限循环。',
    threadSource: 'subagent'
  };
}

export function buildCodexAppServerTurnParams({ threadId, role, projectPath, prompt, permissionProfile }) {
  const reasoningEffort = reasoningEffortForRole(role);
  return {
    threadId,
    input: [{ type: 'text', text: prompt, text_elements: [] }],
    cwd: projectPath,
    approvalPolicy: approvalForPermission(permissionProfile),
    sandboxPolicy: turnSandboxForPermission(permissionProfile, projectPath),
    model: role.model && role.model !== 'default' ? role.model : null,
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
}

function outputFromTurn(turn, fallback) {
  const itemText = (turn?.items || [])
    .map((item) => item?.item?.text || item?.text || item?.content?.text || item?.message?.content)
    .filter(Boolean)
    .join('\n')
    .trim();
  return itemText || fallback.trim();
}

function safeEmit(onEvent, event) {
  if (!onEvent) return;
  try {
    onEvent(event);
  } catch {
    // Event visibility should never break an in-flight Codex turn.
  }
}

export async function invokeCodexViaAppServer({
  role,
  project,
  session,
  prompt,
  permissionProfile,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onEvent
}) {
  await ensureCodexCliServer({ stdio: 'pipe' });
  const client = createRpcClient({ timeoutMs });
  let output = '';
  let threadId = session.hasNativeStarted ? session.native_session_id : null;
  let turnId = null;
  const autoResponses = [];

  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Codex app-server turn after ${timeoutMs}ms`)), timeoutMs);
    client.onNotification((message) => {
      if (message.id && message.method === 'item/permissions/requestApproval') {
        const autoResponse = 'grant-turn-read-network';
        autoResponses.push({ method: message.method, requestId: message.id, autoResponse });
        safeEmit(onEvent, {
          type: 'agent.permission.requested',
          payload: {
            method: message.method,
            requestId: message.id,
            params: message.params,
            threadId,
            turnId,
            permissionProfile,
            autoResponse
          }
        });
        client.respond(message.id, {
          permissions: { fileSystem: { read: null, write: null }, network: { enabled: true } },
          scope: 'turn'
        });
        return;
      }
      if (message.id && message.method?.includes('requestApproval')) {
        const autoResponse = 'decline';
        autoResponses.push({ method: message.method, requestId: message.id, autoResponse });
        safeEmit(onEvent, {
          type: 'agent.approval.requested',
          payload: {
            method: message.method,
            requestId: message.id,
            params: message.params,
            threadId,
            turnId,
            permissionProfile,
            autoResponse
          }
        });
        client.respond(message.id, { decision: 'decline' });
        return;
      }
      if (message.method === 'item/agentMessage/delta' && message.params?.turnId === turnId) {
        output += message.params.delta || '';
      }
      if (message.method === 'turn/completed' && message.params?.turn?.id === turnId) {
        clearTimeout(timer);
        resolve(message.params.turn);
      }
      if (message.method === 'error') {
        clearTimeout(timer);
        reject(new Error(message.params?.message || JSON.stringify(message.params)));
      }
    });
  });

  try {
    await client.request('initialize', {
      clientInfo: { name: 'at-group-chat', version: AT_PACKAGE_VERSION },
      capabilities: { experimentalApiMethods: true }
    });

    if (threadId) {
      try {
        await client.request('thread/resume', {
          ...buildCodexAppServerStartParams({ role, projectPath: project.path, permissionProfile }),
          threadId
        });
      } catch (error) {
        const message = error.message || String(error);
        if (/not found|unknown thread|invalid thread/i.test(message)) {
          threadId = null;
        } else {
          throw error;
        }
      }
    }

    if (!threadId) {
      const started = await client.request(
        'thread/start',
        buildCodexAppServerStartParams({ role, projectPath: project.path, permissionProfile })
      );
      threadId = started.thread.id;
    }

    const turnStarted = await client.request(
      'turn/start',
      buildCodexAppServerTurnParams({
        threadId,
        role,
        projectPath: project.path,
        prompt,
        permissionProfile
      })
    );
    turnId = turnStarted.turn.id;
    const turn = await completed;
    const finalOutput = outputFromTurn(turn, output);
    return {
      ok: turn.status !== 'failed',
      command: `codex app-server ${CODEX_APP_SERVER_URL} thread=${threadId} turn=${turnId}`,
      output: finalOutput || '(Codex app-server returned no assistant text)',
      nativeSessionId: threadId,
      code: turn.status === 'failed' ? 1 : 0,
      stderr: turn.error ? JSON.stringify(turn.error) : '',
      transport: 'codex-app-server',
      autoResponses
    };
  } finally {
    client.close();
  }
}
