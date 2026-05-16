import { EventEmitter } from 'node:events';
import { createStorage } from './storage.js';
import { ROLES, normalizePermissionProfile } from './roles.js';
import { invokeAgent } from './adapters.js';
import { getCodexCliServerStatus } from './codexCliServer.js';
import { listAdapters, validateAgentDefinition } from './adapterRegistry.js';
import { GOAL_REVIEW_ROLE_ID, MANAGER_ROLE_ID } from './constants.js';
import { ClientError } from './errors.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function byteSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null));
  } catch {
    return 0;
  }
}

const MANIFEST_DEFAULT_KEYS = new Set([
  'roleIds',
  'model',
  'thinkingLevel',
  'defaultPermission',
  'adapter',
  'command',
  'commandTemplate',
  'dangerousCommandTemplate'
]);

const MANIFEST_AGENT_KEYS = new Set([
  'roleId',
  'name',
  'cli',
  'adapter',
  'command',
  'commandTemplate',
  'model',
  'thinkingLevel',
  'responsibility',
  'defaultPermission',
  'dangerousCommandTemplate'
]);

function assertPlainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ClientError(`${path} must be an object`);
  }
}

function assertOptionalArray(value, path) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new ClientError(`${path} must be an array`);
  }
}

function rejectUnknownKeys(value, allowedKeys, path) {
  const unknown = Object.keys(value || {}).filter((key) => !allowedKeys.has(key));
  if (unknown.length) {
    throw new ClientError(`${path} has unknown field(s): ${unknown.join(', ')}`);
  }
}

function assertManifestCommandTemplate(agent, path) {
  if (!agent.commandTemplate) return;
  const template = String(agent.commandTemplate);
  const hasShellControl = /(?:;|&&|\||`|\$\(|\n|\r)/.test(template);
  if (hasShellControl && agent.dangerousCommandTemplate !== true) {
    throw new ClientError(`${path}.commandTemplate contains shell control syntax; set dangerousCommandTemplate: true to opt in explicitly`);
  }
}

function manifestWorkItemKey(manifest, item, index) {
  return item.metadata?.manifestKey
    || item.metadata?.idempotencyKey
    || item.metadata?.dedupeKey
    || `${manifest.name || 'AT team manifest'}:${manifest.version || '1'}:${item.type || 'issue'}:${item.title || index}`;
}

export function createRuntime({ storage = createStorage(), agentMode } = {}) {
  const resolvedAgentMode = agentMode ?? process.env.AT_TEAM_AGENT_MODE ?? 'real';
  const activeRuns = new Map();

  let rolesCache = null;
  let rolesCacheAt = 0;
  const ROLES_CACHE_TTL_MS = 10_000;

  function roles() {
    const now = Date.now();
    if (rolesCache && (now - rolesCacheAt) < ROLES_CACHE_TTL_MS) {
      return rolesCache;
    }
    const staticById = Object.fromEntries(ROLES.map((role) => [role.id, role]));
    rolesCache = storage.listAgents().map((agent) => {
      const fallback = staticById[agent.role_id] || {};
      return {
        ...fallback,
        id: agent.role_id,
        name: agent.name,
        cli: agent.cli,
        adapter: agent.adapter || fallback.adapter || agent.cli,
        command: agent.command || fallback.command || agent.cli,
        commandTemplate: agent.command_template || fallback.commandTemplate || '',
        model: agent.model,
        thinkingLevel: agent.thinking_level || fallback.thinkingLevel || 'medium',
        responsibility: agent.responsibility,
        defaultPermission: agent.default_permission,
        mcpTool: fallback.mcpTool || 'team_dispatch_agent',
        accent: fallback.accent || '#64748b'
      };
    });
    rolesCacheAt = now;
    return rolesCache;
  }

  function invalidateRolesCache() {
    rolesCache = null;
    rolesCacheAt = 0;
  }

  function adapters() {
    return listAdapters();
  }

  function getRuntimeRole(roleId) {
    const role = roles().find((item) => item.id === roleId);
    if (!role) throw new Error(`Unknown role: ${roleId}`);
    return role;
  }

  function emitStored(event) {
    emitter.emit('event', event);
    return event;
  }

  function ensureTeam(projectId) {
    const project = storage.getProject(projectId) || storage.ensureDefaultProject();
    const sessions = roles().map((role) => storage.ensureSession({ projectId: project.id, role }));
    assertCodexSplit(project.id);
    return { project, roles: roles(), sessions };
  }

  function assertCodexSplit(projectId) {
    const manager = storage.getSession(projectId, MANAGER_ROLE_ID);
    const reviewer = storage.getSession(projectId, GOAL_REVIEW_ROLE_ID);
    if (manager && reviewer && manager.native_session_id === reviewer.native_session_id) {
      throw new Error(`${MANAGER_ROLE_ID} and ${GOAL_REVIEW_ROLE_ID} must use different native sessions`);
    }
  }

  async function teamStatus(projectId = storage.ensureDefaultProject().id) {
    const { project } = ensureTeam(projectId);
    return {
      project,
      codexCliServer: await getCodexCliServerStatus(),
      adapters: adapters(),
      agents: roles().map((role) => {
        const session = storage.getSession(project.id, role.id);
        return {
          ...role,
          session,
          lastMessages: storage.listMessages({ projectId: project.id, roleId: role.id, limit: 6 })
        };
      }),
      runs: storage.listRuns(project.id),
      events: storage.listEvents({ projectId: project.id, limit: 80 })
    };
  }

  function teamStatusSync(projectId = storage.ensureDefaultProject().id) {
    const { project } = ensureTeam(projectId);
    return {
      project,
      codexCliServer: {
        kind: 'codex app-server',
        url: process.env.CODEX_APP_SERVER_URL || process.env.CODEX_EXEC_SERVER_URL || 'ws://127.0.0.1:5176',
        connected: false,
        command: `codex app-server --listen ${process.env.CODEX_APP_SERVER_URL || process.env.CODEX_EXEC_SERVER_URL || 'ws://127.0.0.1:5176'}`,
        mode: 'long-running app server'
      },
      adapters: adapters(),
      agents: roles().map((role) => {
        const session = storage.getSession(project.id, role.id);
        return {
          ...role,
          session,
          lastMessages: storage.listMessages({ projectId: project.id, roleId: role.id, limit: 6 })
        };
      }),
      runs: storage.listRuns(project.id),
      events: storage.listEvents({ projectId: project.id, limit: 80 })
    };
  }

  function createProject(input) {
    const project = storage.createProject({
      name: input.name || 'Untitled Project',
      path: input.path || process.cwd()
    });
    ensureTeam(project.id);
    emitStored(
      storage.addEvent({
        projectId: project.id,
        type: 'project.created',
        payload: { project }
      })
    );
    return project;
  }

  function createTask({ projectId, title, prompt }) {
    const { project } = ensureTeam(projectId || storage.ensureDefaultProject().id);
    const run = storage.createRun({
      projectId: project.id,
      title: title || prompt.slice(0, 48) || 'Untitled task',
      prompt
    });
    storage.addMessage({
      projectId: project.id,
      roleId: MANAGER_ROLE_ID,
      runId: run.id,
      direction: 'user',
      content: prompt,
      metadata: { source: 'task' }
    });
    emitStored(
      storage.addEvent({
        runId: run.id,
        projectId: project.id,
        roleId: MANAGER_ROLE_ID,
        type: 'run.created',
        payload: { run, loopPolicy: 'manager-controlled' }
      })
    );
    return run;
  }

  function sharedTranscript(projectId, runId) {
    const events = storage.listEvents({ projectId, limit: 120 });
    const runEvents = events.filter((event) => !runId || event.run_id === runId || event.type.startsWith('permission.'));
    const workItems = storage.listWorkItems({ projectId, limit: 20 });
    const messages = roles().flatMap((role) =>
      storage.listMessages({ projectId, roleId: role.id, limit: 10 }).map((message) => ({
        role: role.id,
        direction: message.direction,
        content: message.content,
        created_at: message.created_at
      }))
    ).sort((a, b) => a.created_at.localeCompare(b.created_at));

    return [
      'TEAM TRANSCRIPT（所有 agent 可见，只能由 codex-manager 触发下一步活动）',
      ...messages.slice(-30).map((message) => `[${message.created_at}] ${message.role}/${message.direction}: ${message.content}`),
      '',
      'WORK ITEMS（issue/proposal/review/decision/artifact，像 GitHub 一样承载协作对象）',
      ...workItems.slice(0, 20).map((item) => `#${item.id.slice(0, 8)} ${item.type}/${item.status}/${item.priority}: ${item.title}${item.assigned_role_id ? ` -> ${item.assigned_role_id}` : ''}`),
      '',
      'RECENT EVENTS',
      ...runEvents.slice(-30).map((event) => `[${event.created_at}] ${event.type}: ${event.payload}`)
    ].join('\n');
  }

  function rolePrompt({ role, task, run, projectId, permissionProfile }) {
    const transcript = sharedTranscript(projectId, run?.id);
    return [
      `你是 ${role.name} (${role.id})。`,
      `职责: ${role.responsibility}`,
      `权限: ${permissionProfile}`,
      `思考强度: ${role.thinkingLevel || 'medium'}`,
      '调度规则: 只有 codex-manager 可以决定下一个 agent 是否活动。你不能主动触发其他 agent，不能自由讨论，不能循环调用。',
      '可见上下文: 下面是 team transcript，包含所有 agent 之前说的话和事件。你必须基于它回复。',
      '',
      transcript,
      '',
      `本次 manager 分派任务: ${task}`,
      '',
      '请只输出你的岗位结论、风险、建议的下一步；如果需要其他 agent 介入，只提出建议，由 codex-manager 决定。'
    ].join('\n');
  }

  async function dispatchAgent({ runId, projectId, roleId, task, permissionProfile }) {
    const role = getRuntimeRole(roleId);
    const run = runId ? storage.getRun(runId) : null;
    const project = storage.getProject(projectId || run?.project_id) || storage.ensureDefaultProject();
    ensureTeam(project.id);

    if (role.id !== MANAGER_ROLE_ID && !runId) {
      throw new Error('Non-manager agents require a manager-created run; free discussion is disabled');
    }

    const session = storage.ensureSession({ projectId: project.id, role });
    const effectivePermission = normalizePermissionProfile(permissionProfile, session.permission_profile);
    storage.updatePermission({ projectId: project.id, roleId: role.id, permissionProfile: effectivePermission });

    const started = storage.addEvent({
      runId: run?.id ?? null,
      projectId: project.id,
      roleId: role.id,
      type: 'agent.started',
      payload: {
        roleId: role.id,
        permissionProfile: effectivePermission,
        nativeSessionId: session.native_session_id,
        managerControlled: true
      }
    });
    emitStored(started);

    storage.addMessage({
      projectId: project.id,
      roleId: role.id,
      runId: run?.id ?? null,
      direction: 'manager-dispatch',
      content: task,
      metadata: { permissionProfile: effectivePermission }
    });

    const prompt = rolePrompt({
      role,
      task,
      run,
      projectId: project.id,
      permissionProfile: effectivePermission
    });

    const result = await invokeAgent({
      role,
      project,
      session: {
        ...session,
        hasNativeStarted: session.memory_summary?.startsWith('last successful use') || session.memory_summary?.startsWith('native session started')
      },
      prompt,
      permissionProfile: effectivePermission,
      mode: resolvedAgentMode,
      onEvent: (agentEvent) => {
        emitStored(
          storage.addEvent({
            runId: run?.id ?? null,
            projectId: project.id,
            roleId: role.id,
            type: agentEvent.type,
            payload: {
              roleId: role.id,
              nativeSessionId: session.native_session_id,
              ...agentEvent.payload
            }
          })
        );
      }
    });
    if (result.ok) {
      storage.markSessionUsed({
        projectId: project.id,
        roleId: role.id,
        nativeSessionId: result.nativeSessionId,
        memorySummary: `last successful use at ${new Date().toISOString()}`
      });
    }

    storage.addMessage({
      projectId: project.id,
      roleId: role.id,
      runId: run?.id ?? null,
      direction: 'assistant',
      content: result.output,
      metadata: { command: result.command, ok: result.ok, code: result.code, autoResponses: result.autoResponses || [] }
    });

    const completed = storage.addEvent({
      runId: run?.id ?? null,
      projectId: project.id,
      roleId: role.id,
      type: result.ok ? 'agent.completed' : 'agent.failed',
      payload: {
        roleId: role.id,
        output: result.output,
        stderr: result.stderr,
        command: result.command,
        nativeSessionId: result.nativeSessionId,
        autoResponses: result.autoResponses || [],
        noAutoFollowup: true
      }
    });
    emitStored(completed);

    if (run) storage.updateRunStatus(run.id, result.ok ? 'active' : 'failed');
    return { role, project, run, result };
  }

  function enqueueAgentDispatch({ runId, projectId, roleId, task, permissionProfile }) {
    const role = getRuntimeRole(roleId);
    const run = runId ? storage.getRun(runId) : null;
    const project = storage.getProject(projectId || run?.project_id) || storage.ensureDefaultProject();
    ensureTeam(project.id);

    if (role.id !== MANAGER_ROLE_ID && !runId) {
      throw new Error('Non-manager agents require a manager-created run; free discussion is disabled');
    }

    const key = `${run?.id ?? project.id}:${role.id}`;
    if (activeRuns.has(key)) {
      return {
        accepted: true,
        duplicate: true,
        role,
        project,
        run,
        queued: null
      };
    }

    const session = storage.ensureSession({ projectId: project.id, role });
    const effectivePermission = normalizePermissionProfile(permissionProfile, session.permission_profile);
    const queued = storage.addEvent({
      runId: run?.id ?? null,
      projectId: project.id,
      roleId: role.id,
      type: 'agent.queued',
      payload: {
        roleId: role.id,
        permissionProfile: effectivePermission,
        managerControlled: true,
        noAutoFollowup: true
      }
    });
    emitStored(queued);

    const dispatchPromise = new Promise((resolve) => setTimeout(resolve, 0))
      .then(async () => {
      try {
        await dispatchAgent({
          runId: run?.id ?? null,
          projectId: project.id,
          roleId: role.id,
          task,
          permissionProfile: effectivePermission
        });
        if (run && role.id === MANAGER_ROLE_ID) storage.updateRunStatus(run.id, 'manager-replied');
      } catch (error) {
        const failed = storage.addEvent({
          runId: run?.id ?? null,
          projectId: project.id,
          roleId: role.id,
          type: 'agent.failed',
          payload: {
            roleId: role.id,
            error: error.message,
            noAutoFollowup: true
          }
        });
        emitStored(failed);
        if (run) storage.updateRunStatus(run.id, 'failed');
      } finally {
        activeRuns.delete(key);
      }
    });
    activeRuns.set(key, dispatchPromise);

    return {
      accepted: true,
      role,
      project,
      run,
      queued
    };
  }

  function startManagerTask({ projectId, title, prompt, permissionProfile = 'write-proposed' }) {
    const run = createTask({ projectId, title, prompt });
    storage.updateRunStatus(run.id, 'queued');
    enqueueAgentDispatch({
      runId: run.id,
      projectId: run.project_id,
      roleId: MANAGER_ROLE_ID,
      task: prompt,
      permissionProfile
    });
    return storage.getRun(run.id);
  }

  async function runManagerTask({ projectId, title, prompt, permissionProfile = 'write-proposed' }) {
    const run = createTask({ projectId, title, prompt });
    const key = `${run.id}:${MANAGER_ROLE_ID}`;
    const existing = activeRuns.get(key);
    if (existing) {
      await existing;
      return storage.getRun(run.id);
    }

    const dispatchPromise = (async () => {
      await dispatchAgent({
        runId: run.id,
        projectId: run.project_id,
        roleId: MANAGER_ROLE_ID,
        task: prompt,
        permissionProfile
      });
      storage.updateRunStatus(run.id, 'manager-replied');
    })().catch((error) => {
      storage.updateRunStatus(run.id, 'failed');
      throw error;
    });
    activeRuns.set(key, dispatchPromise);

    try {
      await dispatchPromise;
    } catch (error) {
      throw error;
    } finally {
      activeRuns.delete(key);
    }
    return storage.getRun(run.id);
  }

  async function sendAgentMessage({ projectId, roleId, content, permissionProfile }) {
    if (roleId !== MANAGER_ROLE_ID) {
      const run = createTask({
        projectId,
        title: `Manager dispatch to ${roleId}`,
        prompt: `请 manager 调度 ${roleId}: ${content}`
      });
      return dispatchAgent({
        runId: run.id,
        projectId: run.project_id,
        roleId,
        task: content,
        permissionProfile
      });
    }
    return dispatchAgent({
      projectId,
      roleId: MANAGER_ROLE_ID,
      task: content,
      permissionProfile: permissionProfile || 'write-proposed'
    });
  }

  function setPermission({ projectId, roleId, permissionProfile }) {
    const project = storage.getProject(projectId) || storage.ensureDefaultProject();
    ensureTeam(project.id);
    const session = storage.updatePermission({ projectId: project.id, roleId, permissionProfile });
    emitStored(
      storage.addEvent({
        projectId: project.id,
        roleId,
        type: 'permission.updated',
        payload: { roleId, permissionProfile: session.permission_profile }
      })
    );
    return session;
  }

  function updateAgentConfig({ roleId, config }) {
    if (roleId === MANAGER_ROLE_ID && config.enabled === false) {
      throw new Error(`${MANAGER_ROLE_ID} cannot be disabled`);
    }
    const current = storage.listAgents({ includeDisabled: true }).find((agent) => agent.role_id === roleId);
    const merged = {
      roleId,
      name: config.name ?? current?.name,
      cli: config.cli ?? current?.cli,
      adapter: config.adapter ?? current?.adapter,
      command: config.command ?? current?.command,
      commandTemplate: config.commandTemplate ?? current?.command_template,
      model: config.model ?? current?.model,
      thinkingLevel: config.thinkingLevel ?? current?.thinking_level,
      responsibility: config.responsibility ?? current?.responsibility,
      defaultPermission: config.defaultPermission ?? current?.default_permission
    };
    const validation = validateAgentDefinition(merged);
    if (!validation.ok) throw new Error(validation.failures.join('; '));

    const agent = storage.upsertAgentConfig({ roleId, ...config });
    invalidateRolesCache();
    const project = storage.ensureDefaultProject();
    ensureTeam(project.id);
    emitStored(
      storage.addEvent({
        projectId: project.id,
        roleId,
        type: 'agent.config.updated',
        payload: { roleId, config: agent }
      })
    );
    return agent;
  }

  function createAgent({ roleId, ...config }) {
    return updateAgentConfig({ roleId, config });
  }

  function updateTeamConfig({ roleIds = null, config = {} } = {}) {
    const allowedKeys = [
      'model',
      'thinkingLevel',
      'defaultPermission',
      'adapter',
      'command',
      'commandTemplate'
    ];
    const cleanedConfig = Object.fromEntries(
      Object.entries(config).filter(([key, value]) => allowedKeys.includes(key) && value !== undefined && value !== '')
    );
    if (!Object.keys(cleanedConfig).length) throw new Error('No team config fields provided');

    const activeRoleIds = new Set(roles().map((role) => role.id));
    const targets = (Array.isArray(roleIds) && roleIds.length ? roleIds : [...activeRoleIds])
      .filter((roleId) => activeRoleIds.has(roleId));
    if (!targets.length) throw new Error('No active agents matched team config update');

    const updated = targets.map((roleId) => updateAgentConfig({ roleId, config: cleanedConfig }));
    invalidateRolesCache();
    const project = storage.ensureDefaultProject();
    emitStored(
      storage.addEvent({
        projectId: project.id,
        type: 'team.config.updated',
        payload: { roleIds: targets, config: cleanedConfig }
      })
    );
    return { updated, roleIds: targets, config: cleanedConfig };
  }

  function disableAgent({ roleId }) {
    if (roleId === MANAGER_ROLE_ID) throw new Error(`${MANAGER_ROLE_ID} cannot be disabled`);
    const agent = storage.setAgentEnabled({ roleId, enabled: false });
    invalidateRolesCache();
    const project = storage.ensureDefaultProject();
    emitStored(
      storage.addEvent({
        projectId: project.id,
        roleId,
        type: 'agent.disabled',
        payload: { roleId }
      })
    );
    return agent;
  }

  function getMemory({ projectId, roleId }) {
    const project = storage.getProject(projectId) || storage.ensureDefaultProject();
    ensureTeam(project.id);
    return {
      session: storage.getSession(project.id, roleId),
      messages: storage.listMessages({ projectId: project.id, roleId, limit: 100 }),
      transcript: sharedTranscript(project.id)
    };
  }

  function chatRoom(projectId = storage.ensureDefaultProject().id) {
    const { project } = ensureTeam(projectId);
    const sessionsByRole = new Map(storage.listSessions(project.id).map((session) => [session.role_id, session]));
    const participants = roles().map((role) => {
      const session = sessionsByRole.get(role.id);
      return {
        id: role.id,
        name: role.name,
        adapter: role.adapter,
        model: role.model,
        thinkingLevel: role.thinkingLevel,
        permissionProfile: session?.permission_profile || role.defaultPermission,
        nativeSessionId: session?.native_session_id,
        roomRole: role.id === MANAGER_ROLE_ID ? 'manager' : 'member'
      };
    });
    const messages = storage.listProjectMessages({ projectId: project.id, limit: 120 }).map((message) => ({
      id: message.id,
      runId: message.run_id,
      roleId: message.role_id,
      speaker: message.direction === 'user' ? 'human' : message.role_id,
      direction: message.direction,
      content: message.content,
      metadata: safeJsonParse(message.metadata),
      createdAt: message.created_at
    }));
    return {
      room: {
        id: project.id,
        name: 'AT AI 合作群聊',
        projectId: project.id,
        projectPath: project.path,
        policy: 'manager-controlled',
        loopPolicy: 'no-free-discussion-no-auto-loop'
      },
      participants,
      messages,
      workItems: storage.listWorkItems({ projectId: project.id, limit: 80 }).map(formatWorkItem),
      recentEvents: storage.listEvents({ projectId: project.id, limit: 80 })
    };
  }

  function formatWorkItem(item) {
    return {
      id: item.id,
      projectId: item.project_id,
      type: item.type,
      title: item.title,
      body: item.body,
      status: item.status,
      priority: item.priority,
      createdBy: item.created_by,
      assignedRoleId: item.assigned_role_id,
      linkedRunId: item.linked_run_id,
      parentId: item.parent_id,
      metadata: safeJsonParse(item.metadata),
      createdAt: item.created_at,
      updatedAt: item.updated_at
    };
  }

  function listWorkItems(projectId = storage.ensureDefaultProject().id) {
    const { project } = ensureTeam(projectId);
    return {
      project,
      workItems: storage.listWorkItems({ projectId: project.id, limit: 200 }).map(formatWorkItem)
    };
  }

  function getWorkItemActivity({ projectId, id }) {
    const project = storage.getProject(projectId) || storage.ensureDefaultProject();
    ensureTeam(project.id);
    const item = storage.getWorkItem(id);
    if (!item || item.project_id !== project.id) throw new Error(`Unknown work item: ${id}`);
    const formatted = formatWorkItem(item);
    const relatedItems = storage.listWorkItems({ projectId: project.id, limit: 200 })
      .filter((candidate) => candidate.id === item.id || candidate.parent_id === item.id || candidate.id === item.parent_id)
      .map(formatWorkItem);
    const runIds = new Set([item.linked_run_id, ...relatedItems.map((candidate) => candidate.linkedRunId)].filter(Boolean));
    const events = storage.listEvents({ projectId: project.id, limit: 300 }).filter((event) => {
      if (runIds.has(event.run_id)) return true;
      const payload = safeJsonParse(event.payload, {});
      return payload?.itemId === item.id || payload?.item?.id === item.id || payload?.workItemId === item.id;
    });
    const messages = storage.listProjectMessages({ projectId: project.id, limit: 300 }).filter((message) => runIds.has(message.run_id));
    const runs = storage.listRuns(project.id).filter((run) => runIds.has(run.id));
    return {
      project,
      item: formatted,
      relatedItems,
      runs,
      messages: messages.map((message) => ({
        id: message.id,
        runId: message.run_id,
        roleId: message.role_id,
        direction: message.direction,
        content: message.content,
        metadata: safeJsonParse(message.metadata),
        createdAt: message.created_at
      })),
      events
    };
  }

  function dispatchWorkItem({ projectId, id, prompt = null, permissionProfile = 'write-proposed' }) {
    const project = storage.getProject(projectId) || storage.ensureDefaultProject();
    ensureTeam(project.id);
    const item = storage.getWorkItem(id);
    if (!item || item.project_id !== project.id) throw new Error(`Unknown work item: ${id}`);
    const task = [
      `AT work item #${item.id.slice(0, 8)} (${item.type})`,
      `Title: ${item.title}`,
      `Status: ${item.status}`,
      `Priority: ${item.priority}`,
      item.assigned_role_id ? `Owner: ${item.assigned_role_id}` : 'Owner: unassigned',
      '',
      item.body || '',
      '',
      prompt || '请作为 manager 把这个 work item 转成可执行协作流程；需要 proposal、review、decision 或 artifact 时，只点名一个合适 agent。'
    ].join('\n');
    const run = startManagerTask({
      projectId: project.id,
      title: `[${item.type}] ${item.title}`,
      prompt: task,
      permissionProfile
    });
    const linked = storage.updateWorkItem({ id: item.id, linkedRunId: run.id, status: 'in-progress' });
    emitStored(storage.addEvent({
      runId: run.id,
      projectId: project.id,
      type: 'work.item.dispatched',
      payload: { itemId: item.id, runId: run.id, prompt: task }
    }));
    return {
      item: formatWorkItem(linked),
      run,
      eventStream: `/api/runs/${run.id}/events`
    };
  }

  function createWorkItem({ projectId, type = 'issue', title, body = '', status = 'open', priority = 'medium', assignedRoleId = null, linkedRunId = null, parentId = null, metadata = null, dispatchToManager = false, permissionProfile = 'write-proposed' }) {
    const { project } = ensureTeam(projectId || storage.ensureDefaultProject().id);
    const item = storage.createWorkItem({
      projectId: project.id,
      type,
      title,
      body,
      status,
      priority,
      assignedRoleId,
      linkedRunId,
      parentId,
      metadata
    });
    emitStored(storage.addEvent({
      projectId: project.id,
      type: 'work.item.created',
      payload: { item: formatWorkItem(item) }
    }));
    if (!dispatchToManager) return formatWorkItem(item);

    const run = startManagerTask({
      projectId: project.id,
      title: `[${item.type}] ${item.title}`,
      prompt: [
        `AT work item ${item.type}: ${item.title}`,
        item.body ? `\n${item.body}` : '',
        '',
        `请作为 manager 评估这个 work item，决定是否需要创建 proposal/review 或点名某个 agent。`
      ].join('\n'),
      permissionProfile
    });
    const linked = storage.updateWorkItem({ id: item.id, linkedRunId: run.id, status: 'in-progress' });
    emitStored(storage.addEvent({
      runId: run.id,
      projectId: project.id,
      type: 'work.item.linked_run',
      payload: { itemId: item.id, runId: run.id }
    }));
    return formatWorkItem(linked);
  }

  function ingestDeveloperEvent({
    projectId,
    source = 'external',
    event = 'developer.event',
    type = 'issue',
    title,
    body = '',
    priority = 'medium',
    assignedRoleId = MANAGER_ROLE_ID,
    metadata = {},
    dedupeKey: inputDedupeKey = null,
    deliveryId = null,
    idempotencyKey = null,
    dispatchToManager = false,
    permissionProfile = 'write-proposed'
  }) {
    const { project } = ensureTeam(projectId || storage.ensureDefaultProject().id);
    const dedupeKey = inputDedupeKey || idempotencyKey || deliveryId || metadata?.dedupeKey || metadata?.deliveryId || metadata?.id || null;
    if (dedupeKey) {
      const existing = storage.listWorkItems({ projectId: project.id, limit: 500 }).find((item) => {
        const itemMetadata = safeJsonParse(item.metadata, {});
        return itemMetadata?.dedupeKey === dedupeKey || itemMetadata?.deliveryId === dedupeKey || itemMetadata?.id === dedupeKey;
      });
      if (existing) {
        return {
          ...formatWorkItem(existing),
          duplicate: true
        };
      }
    }
    const workItem = createWorkItem({
      projectId: project.id,
      type,
      title: title || `[${source}] ${event}`,
      body,
      priority,
      assignedRoleId,
      metadata: {
        source,
        event,
        dedupeKey,
        deliveryId: deliveryId || metadata?.deliveryId,
        idempotencyKey: idempotencyKey || metadata?.idempotencyKey,
        receivedAt: new Date().toISOString(),
        ...metadata
      },
      dispatchToManager,
      permissionProfile
    });
    emitStored(storage.addEvent({
      projectId: project.id,
      type: 'developer.event.received',
      payload: {
        source,
        event,
        itemId: workItem.id,
        dispatchToManager,
        metadata
      }
    }));
    return workItem;
  }

  function applyTeamManifest({ projectId, manifest = {} }) {
    assertPlainObject(manifest, 'manifest');
    if (manifest.defaults !== undefined) {
      assertPlainObject(manifest.defaults, 'manifest.defaults');
      rejectUnknownKeys(manifest.defaults, MANIFEST_DEFAULT_KEYS, 'manifest.defaults');
      assertManifestCommandTemplate(manifest.defaults, 'manifest.defaults');
    }
    assertOptionalArray(manifest.agents, 'manifest.agents');
    assertOptionalArray(manifest.workItems, 'manifest.workItems');
    (manifest.agents || []).forEach((agent, index) => {
      assertPlainObject(agent, `manifest.agents[${index}]`);
      rejectUnknownKeys(agent, MANIFEST_AGENT_KEYS, `manifest.agents[${index}]`);
      if (!agent.roleId) throw new ClientError(`manifest.agents[${index}].roleId is required`);
      assertManifestCommandTemplate(agent, `manifest.agents[${index}]`);
    });
    (manifest.workItems || []).forEach((item, index) => {
      assertPlainObject(item, `manifest.workItems[${index}]`);
      if (!item.title) throw new ClientError(`manifest.workItems[${index}].title is required`);
    });

    return storage.transaction(() => {
      const { project } = ensureTeam(projectId || manifest.projectId || storage.ensureDefaultProject().id);
      const applied = {
        defaults: null,
        agents: [],
        workItems: [],
        existingWorkItems: []
      };

      if (manifest.defaults && Object.keys(manifest.defaults).length) {
        applied.defaults = updateTeamConfig({
          roleIds: manifest.defaults.roleIds,
          config: manifest.defaults
        });
      }

      if (Array.isArray(manifest.agents)) {
        applied.agents = manifest.agents.map(({ dangerousCommandTemplate, ...agent }) => createAgent(agent));
      }

      if (Array.isArray(manifest.workItems)) {
        const existingItems = storage.listWorkItems({ projectId: project.id, limit: 1000 });
        const existingByManifestKey = new Map(existingItems.map((item) => {
          const metadata = safeJsonParse(item.metadata, {});
          return metadata?.manifestKey ? [metadata.manifestKey, item] : null;
        }).filter(Boolean));
        applied.workItems = manifest.workItems.map((item, index) => {
          const manifestKey = manifestWorkItemKey(manifest, item, index);
          const metadata = {
            ...(item.metadata || {}),
            manifestName: manifest.name || 'AT team manifest',
            manifestVersion: manifest.version || '1',
            manifestKey
          };
          const existing = existingByManifestKey.get(manifestKey);
          if (existing) {
            const updated = updateWorkItem({
              projectId: project.id,
              id: existing.id,
              type: item.type,
              title: item.title,
              body: item.body,
              status: item.status,
              priority: item.priority,
              assignedRoleId: item.assignedRoleId,
              linkedRunId: item.linkedRunId,
              parentId: item.parentId,
              metadata
            });
            applied.existingWorkItems.push(updated.id);
            return { ...updated, manifestExisting: true };
          }
          return createWorkItem({
            projectId: project.id,
            ...item,
            metadata
          });
        });
      }

      emitStored(storage.addEvent({
        projectId: project.id,
        type: 'team.manifest.applied',
        payload: {
          name: manifest.name || 'AT team manifest',
          defaults: Boolean(applied.defaults),
          agents: applied.agents.map((agent) => agent.role_id),
          workItems: applied.workItems.map((item) => item.id),
          existingWorkItems: applied.existingWorkItems
        }
      }));

      return {
        project,
        manifest: {
          name: manifest.name || 'AT team manifest',
          version: manifest.version || '1'
        },
        applied,
        status: teamStatusSync(project.id)
      };
    });
  }

  function updateWorkItem({ projectId, id, ...updates }) {
    const project = storage.getProject(projectId) || storage.ensureDefaultProject();
    ensureTeam(project.id);
    const current = storage.getWorkItem(id);
    if (!current) throw new Error(`Unknown work item: ${id}`);
    if (current.project_id !== project.id) throw new ClientError('Work item does not belong to project');
    const item = storage.updateWorkItem({ id, ...updates });
    emitStored(storage.addEvent({
      projectId: project.id,
      roleId: updates.assignedRoleId || item.assigned_role_id,
      type: 'work.item.updated',
      payload: { item: formatWorkItem(item), updates }
    }));
    return formatWorkItem(item);
  }

  function postChatMessage({ projectId, content, title, permissionProfile = 'write-proposed' }) {
    const trimmed = String(content || '').trim();
    if (!trimmed) throw new Error('AT chat message content is required');
    const run = startManagerTask({
      projectId,
      title: title || trimmed.slice(0, 48) || 'AT chat message',
      prompt: trimmed,
      permissionProfile
    });
    return {
      accepted: true,
      room: chatRoom(run.project_id).room,
      run,
      eventStream: `/api/runs/${run.id}/events`
    };
  }

  async function platformHealth(projectId = storage.ensureDefaultProject().id) {
    const status = await teamStatus(projectId);
    const defaultRoleIds = new Set(ROLES.map((role) => role.id));
    const activeRoleIds = new Set(status.agents.map((agent) => agent.id));
    const disabledAgents = storage.listAgents({ includeDisabled: true }).filter((agent) => !agent.enabled);
    const failureWindowMs = 24 * 60 * 60 * 1000;
    const failureCutoff = Date.now() - failureWindowMs;
    const recentFailures = status.events
      .filter((event) => event.type === 'agent.failed')
      .filter((event) => new Date(event.created_at).getTime() >= failureCutoff)
      .slice(-10);
    const allFailures = status.events.filter((event) => event.type === 'agent.failed');
    const manager = status.agents.find((agent) => agent.id === MANAGER_ROLE_ID);
    const goal = status.agents.find((agent) => agent.id === GOAL_REVIEW_ROLE_ID);
    const checks = [
      {
        id: 'codex-app-server',
        label: 'Codex app-server connected',
        ok: status.codexCliServer?.kind === 'codex app-server' && status.codexCliServer?.connected === true
      },
      {
        id: 'codex-session-split',
        label: 'Codex manager and goal reviewer are separate sessions',
        ok: Boolean(manager && goal && manager.session.native_session_id !== goal.session.native_session_id)
      },
      {
        id: 'default-roles',
        label: 'Default team roles are active',
        ok: [...defaultRoleIds].every((roleId) => activeRoleIds.has(roleId))
      },
      {
        id: 'manager-controlled',
        label: 'Manager-controlled dispatch is enforced',
        ok: true
      },
      {
        id: 'adapter-registry',
        label: 'Adapter registry is available',
        ok: adapters().length >= 4
      }
    ];

    return {
      ok: checks.every((check) => check.ok),
      generatedAt: new Date().toISOString(),
      project: status.project,
      checks,
      setup: {
        authEnabled: Boolean(process.env.AT_TEAM_API_TOKEN),
        agentMode: resolvedAgentMode,
        codexServer: status.codexCliServer,
        cliAvailability: {
          codex: status.agents.some((agent) => agent.cli === 'codex'),
          claude: status.agents.some((agent) => agent.cli === 'claude'),
          kimi: status.agents.some((agent) => agent.cli === 'kimi'),
          generic: status.agents.some((agent) => agent.adapter === 'generic-cli')
        },
        dataPath: process.env.AT_TEAM_DB_PATH || 'data/at-team.sqlite'
      },
      security: {
        authEnabled: Boolean(process.env.AT_TEAM_API_TOKEN),
        hookAuthEnabled: Boolean(process.env.AT_TEAM_HOOK_TOKEN),
        corsOrigin: process.env.AT_TEAM_CORS_ORIGIN || 'http://127.0.0.1:5173',
        maxBodyBytes: Number(process.env.AT_TEAM_MAX_BODY_BYTES || 1024 * 1024),
        maxTextFieldLength: Number(process.env.AT_TEAM_MAX_TEXT_FIELD_LENGTH || 32000),
        permissionProfiles: ['readonly', 'write-proposed', 'workspace-write', 'danger']
      },
      maintenance: {
        dataPath: process.env.AT_TEAM_DB_PATH || 'data/at-team.sqlite',
        exportBytes: byteSize(platformExport(status.project.id)),
        cleanupPreviewOnly: true
      },
      adapters: adapters(),
      counts: {
        activeAgents: status.agents.length,
        disabledAgents: disabledAgents.length,
        runs: status.runs.length,
        recentEvents: status.events.length,
        recentFailures: recentFailures.length,
        historicalFailures: allFailures.length
      },
      codexCliServer: status.codexCliServer,
      recentFailures
    };
  }

  function platformExport(projectId = storage.ensureDefaultProject().id) {
    const project = storage.getProject(projectId) || storage.ensureDefaultProject();
    const agents = storage.listAgents({ includeDisabled: true });
    return {
      exportedAt: new Date().toISOString(),
      format: 'at-agent-team-platform-export/v1',
      project,
      adapters: adapters(),
      agents,
      sessions: storage.listSessions(project.id),
      runs: storage.listRuns(project.id),
      workItems: storage.listWorkItems({ projectId: project.id, limit: 500 }).map(formatWorkItem),
      messages: storage.listProjectMessages({ projectId: project.id, limit: 500 }),
      events: storage.listEvents({ projectId: project.id, limit: 500 })
    };
  }

  return {
    storage,
    events: emitter,
    ensureTeam,
    teamStatus,
    teamStatusSync,
    adapters,
    platformHealth,
    platformExport,
    listWorkItems,
    createWorkItem,
    ingestDeveloperEvent,
    applyTeamManifest,
    updateWorkItem,
    getWorkItemActivity,
    dispatchWorkItem,
    chatRoom,
    postChatMessage,
    createProject,
    createTask,
    startManagerTask,
    runManagerTask,
    enqueueAgentDispatch,
    dispatchAgent,
    sendAgentMessage,
    setPermission,
    createAgent,
    updateTeamConfig,
    disableAgent,
    updateAgentConfig,
    getMemory
  };
}
