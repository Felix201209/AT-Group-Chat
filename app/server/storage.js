import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { ROLES, normalizePermissionProfile, normalizeThinkingLevel } from './roles.js';

const DEFAULT_DATA_DIR = join(process.cwd(), 'data');
const DEFAULT_DB_PATH = join(DEFAULT_DATA_DIR, 'at-team.sqlite');
const SCHEMA_VERSION = 2;
const MAX_CACHED_STATEMENTS = 128;

export function createStorage({ dbPath = process.env.AT_TEAM_DB_PATH || DEFAULT_DB_PATH, eventLogPath: configuredEventLogPath } = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const eventLogPath = configuredEventLogPath === undefined ? join(dirname(dbPath), 'events.jsonl') : configuredEventLogPath;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  const statementCache = new Map();

  function prepare(sql) {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      if (statementCache.size >= MAX_CACHED_STATEMENTS) {
        const oldestKey = statementCache.keys().next().value;
        statementCache.delete(oldestKey);
      }
      statementCache.set(sql, statement);
    }
    return statement;
  }

  function appendEventLog(event) {
    if (!eventLogPath) return;
    appendFile(eventLogPath, `${JSON.stringify(event)}\n`).catch(() => {
      // SQLite is the source of truth; JSONL is an audit mirror and must not block dispatch.
    });
  }

  function now() {
    return new Date().toISOString();
  }

  function transaction(fn) {
    return db.transaction(fn)();
  }

  function init() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        role_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cli TEXT NOT NULL,
        adapter TEXT NOT NULL DEFAULT '',
        command TEXT NOT NULL DEFAULT '',
        command_template TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        thinking_level TEXT NOT NULL DEFAULT 'medium',
        responsibility TEXT NOT NULL,
        default_permission TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        native_session_id TEXT NOT NULL,
        permission_profile TEXT NOT NULL,
        memory_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, role_id)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        run_id TEXT,
        direction TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        project_id TEXT,
        role_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        created_by TEXT NOT NULL DEFAULT 'human',
        assigned_role_id TEXT,
        linked_run_id TEXT,
        parent_id TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const tableInfo = prepare("PRAGMA table_info(agents);").all();
    const columns = new Set(tableInfo.map((c) => c.name));
    const migrations = [
      { col: 'adapter', sql: 'ALTER TABLE agents ADD COLUMN adapter TEXT NOT NULL DEFAULT "";' },
      { col: 'command', sql: 'ALTER TABLE agents ADD COLUMN command TEXT NOT NULL DEFAULT "";' },
      { col: 'command_template', sql: 'ALTER TABLE agents ADD COLUMN command_template TEXT NOT NULL DEFAULT "";' },
      { col: 'thinking_level', sql: 'ALTER TABLE agents ADD COLUMN thinking_level TEXT NOT NULL DEFAULT "medium";' },
      { col: 'enabled', sql: 'ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;' }
    ];
    for (const { col, sql } of migrations) {
      if (!columns.has(col)) db.exec(sql);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);

    const insertAgent = prepare(`
      INSERT INTO agents (role_id, name, cli, adapter, command, command_template, model, thinking_level, responsibility, default_permission, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(role_id) DO UPDATE SET
        name = excluded.name,
        cli = excluded.cli,
        adapter = COALESCE(NULLIF(agents.adapter, ''), excluded.adapter),
        command = COALESCE(NULLIF(agents.command, ''), excluded.command),
        command_template = COALESCE(NULLIF(agents.command_template, ''), excluded.command_template),
        model = COALESCE(NULLIF(agents.model, ''), excluded.model),
        thinking_level = COALESCE(NULLIF(agents.thinking_level, ''), excluded.thinking_level),
        responsibility = COALESCE(NULLIF(agents.responsibility, ''), excluded.responsibility),
        default_permission = COALESCE(NULLIF(agents.default_permission, ''), excluded.default_permission),
        enabled = 1;
    `);

    for (const role of ROLES) {
      insertAgent.run(
        role.id,
        role.name,
        role.cli,
        role.adapter || '',
        role.command || '',
        role.commandTemplate || '',
        role.model || 'default',
        role.thinkingLevel || 'medium',
        role.responsibility,
        role.defaultPermission,
        now()
      );
    }

    if (eventLogPath && !existsSync(eventLogPath)) writeFileSync(eventLogPath, '');
  }

  function createProject({ name, path }) {
    const id = randomUUID();
    const createdAt = now();
    prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?);').run(id, name, path, createdAt);
    return getProject(id);
  }

  function ensureDefaultProject() {
    const existing = prepare('SELECT * FROM projects ORDER BY created_at ASC LIMIT 1;').get();
    if (existing) return existing;
    return createProject({ name: 'AT Group Chat', path: process.cwd() });
  }

  function getProject(projectId) {
    return prepare('SELECT * FROM projects WHERE id = ? LIMIT 1;').get(projectId) ?? null;
  }

  function listProjects() {
    return prepare('SELECT * FROM projects ORDER BY created_at ASC;').all();
  }

  function listAgents({ includeDisabled = false } = {}) {
    const sql = includeDisabled
      ? 'SELECT * FROM agents ORDER BY created_at ASC;'
      : 'SELECT * FROM agents WHERE enabled = 1 ORDER BY created_at ASC;';
    return prepare(sql).all();
  }

  function updateAgentConfig({ roleId, name, cli, adapter, command, commandTemplate, model, thinkingLevel, responsibility, defaultPermission, enabled }) {
    const current = prepare('SELECT * FROM agents WHERE role_id = ? LIMIT 1;').get(roleId);
    if (!current) throw new Error(`Unknown agent: ${roleId}`);
    const nextThinkingLevel = thinkingLevel === undefined ? current.thinking_level : normalizeThinkingLevel(thinkingLevel, current.thinking_level || 'medium');
    prepare(`
      UPDATE agents
      SET name = ?,
          cli = ?,
          adapter = ?,
          command = ?,
          command_template = ?,
          model = ?,
          thinking_level = ?,
          responsibility = ?,
          default_permission = ?,
          enabled = ?
      WHERE role_id = ?;
    `).run(
      name ?? current.name,
      cli ?? current.cli,
      adapter ?? current.adapter,
      command ?? current.command,
      commandTemplate ?? current.command_template,
      model ?? current.model,
      nextThinkingLevel,
      responsibility ?? current.responsibility,
      defaultPermission ?? current.default_permission,
      Number(enabled ?? current.enabled ?? 1) ? 1 : 0,
      roleId
    );
    return prepare('SELECT * FROM agents WHERE role_id = ? LIMIT 1;').get(roleId);
  }

  function upsertAgentConfig({ roleId, name, cli, adapter, command, commandTemplate, model, thinkingLevel, responsibility, defaultPermission, enabled }) {
    if (!roleId) throw new Error('roleId is required');
    const current = prepare('SELECT * FROM agents WHERE role_id = ? LIMIT 1;').get(roleId);
    if (current) {
      return updateAgentConfig({ roleId, name, cli, adapter, command, commandTemplate, model, thinkingLevel, responsibility, defaultPermission, enabled: enabled ?? 1 });
    }
    const createdAt = now();
    const normalizedPermission = normalizePermissionProfile(defaultPermission || 'readonly');
    const normalizedThinking = normalizeThinkingLevel(thinkingLevel || 'medium');
    prepare(`
      INSERT INTO agents (role_id, name, cli, adapter, command, command_template, model, thinking_level, responsibility, default_permission, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      roleId,
      name || roleId,
      cli || 'generic',
      adapter || 'generic-cli',
      command || 'zsh',
      commandTemplate || '',
      model || 'default',
      normalizedThinking,
      responsibility || 'Generic local CLI agent.',
      normalizedPermission,
      Number(enabled ?? 1) ? 1 : 0,
      createdAt
    );
    return prepare('SELECT * FROM agents WHERE role_id = ? LIMIT 1;').get(roleId);
  }

  function setAgentEnabled({ roleId, enabled }) {
    const current = prepare('SELECT * FROM agents WHERE role_id = ? LIMIT 1;').get(roleId);
    if (!current) throw new Error(`Unknown agent: ${roleId}`);
    prepare('UPDATE agents SET enabled = ? WHERE role_id = ?;').run(enabled ? 1 : 0, roleId);
    return prepare('SELECT * FROM agents WHERE role_id = ? LIMIT 1;').get(roleId);
  }

  function ensureSession({ projectId, role }) {
    const existing = prepare('SELECT * FROM agent_sessions WHERE project_id = ? AND role_id = ? LIMIT 1;').get(projectId, role.id);
    if (existing) return existing;

    const id = randomUUID();
    const nativeSessionId = randomUUID();
    const createdAt = now();
    prepare(`
      INSERT INTO agent_sessions (id, project_id, role_id, native_session_id, permission_profile, memory_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?);
    `).run(id, projectId, role.id, nativeSessionId, role.defaultPermission, createdAt, createdAt);
    return getSession(projectId, role.id);
  }

  function getSession(projectId, roleId) {
    return prepare('SELECT * FROM agent_sessions WHERE project_id = ? AND role_id = ? LIMIT 1;').get(projectId, roleId) ?? null;
  }

  function listSessions(projectId) {
    return prepare(`
      SELECT s.*, a.name, a.cli, a.adapter, a.command, a.command_template, a.model, a.thinking_level, a.responsibility, a.default_permission
      FROM agent_sessions s
      JOIN agents a ON a.role_id = s.role_id
      WHERE s.project_id = ?
      ORDER BY a.created_at ASC;
    `).all(projectId);
  }

  function updatePermission({ projectId, roleId, permissionProfile }) {
    const normalized = normalizePermissionProfile(permissionProfile);
    prepare('UPDATE agent_sessions SET permission_profile = ?, updated_at = ? WHERE project_id = ? AND role_id = ?;')
      .run(normalized, now(), projectId, roleId);
    return getSession(projectId, roleId);
  }

  function markSessionUsed({ projectId, roleId, nativeSessionId = null, memorySummary = null }) {
    const current = getSession(projectId, roleId);
    if (!current) throw new Error(`Unknown session: ${projectId}/${roleId}`);
    const nextNativeId = nativeSessionId || current?.native_session_id;
    const nextMemorySummary = memorySummary || current?.memory_summary || 'native session started';
    prepare('UPDATE agent_sessions SET native_session_id = ?, memory_summary = ?, updated_at = ? WHERE project_id = ? AND role_id = ?;')
      .run(nextNativeId, nextMemorySummary, now(), projectId, roleId);
    return getSession(projectId, roleId);
  }

  function createRun({ projectId, title, prompt }) {
    const id = randomUUID();
    const createdAt = now();
    prepare('INSERT INTO runs (id, project_id, title, prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);')
      .run(id, projectId, title, prompt, 'queued', createdAt, createdAt);
    return getRun(id);
  }

  function getRun(runId) {
    return prepare('SELECT * FROM runs WHERE id = ? LIMIT 1;').get(runId) ?? null;
  }

  function updateRunStatus(runId, status) {
    prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?;').run(status, now(), runId);
    return getRun(runId);
  }

  function listRuns(projectId) {
    return prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50;').all(projectId);
  }

  function normalizeWorkItemType(type = 'issue') {
    const normalized = String(type || 'issue').trim();
    if (!['issue', 'proposal', 'review', 'decision', 'artifact'].includes(normalized)) {
      throw new Error('Unsupported work item type');
    }
    return normalized;
  }

  function normalizeWorkItemStatus(status = 'open') {
    const normalized = String(status || 'open').trim();
    if (!['open', 'in-progress', 'review', 'accepted', 'closed'].includes(normalized)) {
      throw new Error('Unsupported work item status');
    }
    return normalized;
  }

  function normalizeWorkItemPriority(priority = 'medium') {
    const normalized = String(priority || 'medium').trim();
    if (!['low', 'medium', 'high', 'urgent'].includes(normalized)) {
      throw new Error('Unsupported work item priority');
    }
    return normalized;
  }

  function getWorkItem(id) {
    return prepare('SELECT * FROM work_items WHERE id = ? LIMIT 1;').get(id) ?? null;
  }

  function createWorkItem({ projectId, type = 'issue', title, body = '', status = 'open', priority = 'medium', createdBy = 'human', assignedRoleId = null, linkedRunId = null, parentId = null, metadata = null }) {
    const trimmedTitle = String(title || '').trim();
    if (!trimmedTitle) throw new Error('work item title is required');
    const id = randomUUID();
    const createdAt = now();
    prepare(`
      INSERT INTO work_items (id, project_id, type, title, body, status, priority, created_by, assigned_role_id, linked_run_id, parent_id, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      id,
      projectId,
      normalizeWorkItemType(type),
      trimmedTitle,
      body || '',
      normalizeWorkItemStatus(status),
      normalizeWorkItemPriority(priority),
      createdBy || 'human',
      assignedRoleId,
      linkedRunId,
      parentId,
      metadata ? JSON.stringify(metadata) : null,
      createdAt,
      createdAt
    );
    return getWorkItem(id);
  }

  function updateWorkItem({ id, type, title, body, status, priority, assignedRoleId, linkedRunId, parentId, metadata }) {
    const current = getWorkItem(id);
    if (!current) throw new Error(`Unknown work item: ${id}`);
    prepare(`
      UPDATE work_items
      SET type = ?, title = ?, body = ?, status = ?, priority = ?, assigned_role_id = ?, linked_run_id = ?, parent_id = ?, metadata = ?, updated_at = ?
      WHERE id = ?;
    `).run(
      type === undefined ? current.type : normalizeWorkItemType(type),
      title ?? current.title,
      body ?? current.body,
      status === undefined ? current.status : normalizeWorkItemStatus(status),
      priority === undefined ? current.priority : normalizeWorkItemPriority(priority),
      assignedRoleId === undefined ? current.assigned_role_id : assignedRoleId,
      linkedRunId === undefined ? current.linked_run_id : linkedRunId,
      parentId === undefined ? current.parent_id : parentId,
      metadata === undefined ? current.metadata : JSON.stringify(metadata),
      now(),
      id
    );
    return getWorkItem(id);
  }

  function listWorkItems({ projectId, type = null, status = null, limit = 200 } = {}) {
    const conditions = ['project_id = ?'];
    const params = [projectId];
    if (type) {
      conditions.push('type = ?');
      params.push(normalizeWorkItemType(type));
    }
    if (status) {
      conditions.push('status = ?');
      params.push(normalizeWorkItemStatus(status));
    }
    const sql = `SELECT * FROM work_items WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC, created_at DESC LIMIT ?;`;
    params.push(Number(limit) || 200);
    return prepare(sql).all(...params);
  }

  function addMessage({ projectId, roleId, runId = null, direction, content, metadata = null }) {
    const id = randomUUID();
    const createdAt = now();
    prepare('INSERT INTO messages (id, project_id, role_id, run_id, direction, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);')
      .run(id, projectId, roleId, runId, direction, content, metadata ? JSON.stringify(metadata) : null, createdAt);
    return prepare('SELECT * FROM messages WHERE id = ? LIMIT 1;').get(id);
  }

  function listMessages({ projectId, roleId, limit = 40 }) {
    return prepare('SELECT * FROM messages WHERE project_id = ? AND role_id = ? ORDER BY created_at DESC LIMIT ?;')
      .all(projectId, roleId, Number(limit) || 40)
      .reverse();
  }

  function listProjectMessages({ projectId, limit = 120 }) {
    return prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at DESC LIMIT ?;')
      .all(projectId, Number(limit) || 120)
      .reverse();
  }

  function addEvent({ runId = null, projectId = null, roleId = null, type, payload }) {
    const createdAt = now();
    const result = prepare('INSERT INTO events (run_id, project_id, role_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?);')
      .run(runId, projectId, roleId, type, JSON.stringify(payload ?? null), createdAt);
    const event = prepare('SELECT * FROM events WHERE id = ? LIMIT 1;').get(result.lastInsertRowid);
    appendEventLog(event);
    return event;
  }

  function listEvents({ runId = null, projectId = null, afterId = 0, limit = 200 } = {}) {
    const conditions = ['id > ?'];
    const params = [Number(afterId) || 0];
    if (runId) {
      conditions.push('run_id = ?');
      params.push(runId);
    }
    if (projectId) {
      conditions.push('project_id = ?');
      params.push(projectId);
    }
    const sort = afterId ? 'ORDER BY id ASC' : 'ORDER BY id DESC';
    const sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ${sort} LIMIT ?;`;
    params.push(Number(limit) || 200);
    const rows = prepare(sql).all(...params);
    return afterId ? rows : rows.reverse();
  }

  init();

  return {
    dbPath,
    eventLogPath,
    transaction,
    createProject,
    ensureDefaultProject,
    getProject,
    listProjects,
    listAgents,
    updateAgentConfig,
    upsertAgentConfig,
    setAgentEnabled,
    ensureSession,
    getSession,
    listSessions,
    updatePermission,
    markSessionUsed,
    createRun,
    getRun,
    updateRunStatus,
    listRuns,
    getWorkItem,
    createWorkItem,
    updateWorkItem,
    getWorkItem,
    listWorkItems,
    addMessage,
    listMessages,
    listProjectMessages,
    addEvent,
    listEvents
  };
}
