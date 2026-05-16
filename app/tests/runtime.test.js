import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createStorage } from '../server/storage.js';
import { createRuntime } from '../server/runtime.js';
import { buildCommand, invokeAgent } from '../server/adapters.js';
import { buildCodexAppServerStartParams, buildCodexAppServerTurnParams } from '../server/codexAppServerClient.js';

function withRuntime() {
  const dir = mkdtempSync(join(tmpdir(), 'at-team-test-'));
  const storage = createStorage({ dbPath: join(dir, 'test.sqlite'), eventLogPath: null });
  const runtime = createRuntime({ storage, agentMode: 'mock' });
  return {
    runtime,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('Codex manager and Codex goal reviewer use different project-role sessions', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const status = runtime.teamStatusSync();
    const manager = status.agents.find((agent) => agent.id === 'codex-manager').session;
    const goal = status.agents.find((agent) => agent.id === 'codex-goal-review').session;
    assert.notEqual(manager.native_session_id, goal.native_session_id);
  } finally {
    cleanup();
  }
});

test('storage reuses prepared statements and refuses missing session updates', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const status = runtime.teamStatusSync();
    assert.ok(status.project.id);
    const db = new Database(runtime.storage.dbPath);
    assert.equal(db.pragma('user_version', { simple: true }), 2);
    db.close();
    assert.throws(
      () => runtime.storage.markSessionUsed({ projectId: status.project.id, roleId: 'missing-agent' }),
      /Unknown session/
    );
  } finally {
    cleanup();
  }
});

test('manager-created dispatch writes run events and does not auto-trigger another agent', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const run = await runtime.runManagerTask({
      prompt: '检查当前项目目标。',
      permissionProfile: 'write-proposed'
    });
    await runtime.dispatchAgent({
      runId: run.id,
      roleId: 'kimi-ux-review',
      task: '从 UI/UX 角度审查。',
      permissionProfile: 'readonly'
    });
    const events = runtime.storage.listEvents({ runId: run.id });
    assert.ok(events.some((event) => event.type === 'run.created'));
    assert.equal(events.filter((event) => event.type === 'agent.started' && event.role_id === 'kimi-ux-review').length, 1);
    assert.ok(events.every((event) => !JSON.parse(event.payload).autoTriggered));
  } finally {
    cleanup();
  }
});

test('startManagerTask queues manager work immediately for interactive UI', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const run = runtime.startManagerTask({
      prompt: '交互式启动 manager。',
      permissionProfile: 'write-proposed'
    });
    assert.equal(run.status, 'queued');
    const immediateEvents = runtime.storage.listEvents({ runId: run.id });
    assert.ok(immediateEvents.some((event) => event.type === 'run.created'));
    assert.ok(immediateEvents.some((event) => event.type === 'agent.queued'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const laterEvents = runtime.storage.listEvents({ runId: run.id });
    assert.ok(laterEvents.some((event) => event.type === 'agent.completed'));
  } finally {
    cleanup();
  }
});

test('queued dispatch deduplicates active run-role work', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const run = runtime.createTask({ prompt: 'dedupe dispatch test' });
    const first = runtime.enqueueAgentDispatch({
      runId: run.id,
      roleId: 'codex-manager',
      task: 'first manager turn',
      permissionProfile: 'readonly'
    });
    const second = runtime.enqueueAgentDispatch({
      runId: run.id,
      roleId: 'codex-manager',
      task: 'duplicate manager turn',
      permissionProfile: 'readonly'
    });
    assert.equal(first.accepted, true);
    assert.equal(second.duplicate, true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const queued = runtime.storage.listEvents({ runId: run.id }).filter((event) => event.type === 'agent.queued');
    assert.equal(queued.length, 1);
  } finally {
    cleanup();
  }
});

test('AT chat room posts user messages as manager-controlled group chat runs', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const posted = runtime.postChatMessage({
      content: 'AT 群聊消息：请 manager 判断是否需要点名成员。',
      permissionProfile: 'readonly'
    });
    assert.equal(posted.accepted, true);
    assert.equal(posted.room.name, 'AT AI 合作群聊');
    assert.match(posted.eventStream, new RegExp(`/api/runs/${posted.run.id}/events`));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const room = runtime.chatRoom(posted.run.project_id);
    assert.ok(room.participants.some((participant) => participant.roomRole === 'manager'));
    assert.ok(room.messages.some((message) => message.speaker === 'human' && message.content.includes('AT 群聊消息')));
    assert.ok(room.recentEvents.some((event) => event.type === 'agent.queued'));
  } finally {
    cleanup();
  }
});

test('chat room tolerates corrupted JSON metadata fields', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const project = runtime.storage.ensureDefaultProject();
    runtime.ensureTeam(project.id);
    runtime.storage.addMessage({
      projectId: project.id,
      roleId: 'codex-manager',
      direction: 'assistant',
      content: 'metadata corruption test',
      metadata: { ok: true }
    });
    const message = runtime.storage.listProjectMessages({ projectId: project.id }).at(-1);
    const db = new Database(runtime.storage.dbPath);
    db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run('{bad json', message.id);
    db.close();
    const room = runtime.chatRoom(project.id);
    assert.ok(room.messages.some((item) => item.content === 'metadata corruption test' && item.metadata === null));
  } finally {
    cleanup();
  }
});

test('permission updates are persisted for later dispatches', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const status = runtime.teamStatusSync();
    const projectId = status.project.id;
    runtime.setPermission({
      projectId,
      roleId: 'claude-deep-review',
      permissionProfile: 'workspace-write'
    });
    const run = runtime.createTask({ projectId, prompt: '审查权限传递。' });
    await runtime.dispatchAgent({
      runId: run.id,
      roleId: 'claude-deep-review',
      task: '确认使用最新权限。'
    });
    const session = runtime.storage.getSession(projectId, 'claude-deep-review');
    assert.equal(session.permission_profile, 'workspace-write');
    const completed = runtime.storage
      .listEvents({ runId: run.id })
      .find((event) => event.type === 'agent.completed' && event.role_id === 'claude-deep-review');
    assert.match(JSON.parse(completed.payload).output, /权限: workspace-write/);
  } finally {
    cleanup();
  }
});

test('project switching creates separate role memories', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const first = runtime.teamStatusSync().project;
    const second = runtime.createProject({ name: 'Second', path: '/tmp/second' });
    const firstManager = runtime.teamStatusSync(first.id).agents.find((agent) => agent.id === 'codex-manager').session;
    const secondManager = runtime.teamStatusSync(second.id).agents.find((agent) => agent.id === 'codex-manager').session;
    assert.notEqual(firstManager.native_session_id, secondManager.native_session_id);
  } finally {
    cleanup();
  }
});

test('Codex roles do not build codex exec commands', async () => {
  assert.throws(() => buildCommand({
    role: { id: 'codex-manager', cli: 'codex', adapter: 'codex-app-server' },
    projectPath: '/tmp/project',
    session: { native_session_id: 'synthetic', hasNativeStarted: false },
    prompt: 'hello',
    permissionProfile: 'readonly'
  }), /app-server/);

  const result = await invokeAgent({
    role: { id: 'codex-manager', cli: 'codex', adapter: 'codex-app-server', name: 'Team Manager' },
    project: { path: process.cwd() },
    session: { native_session_id: 'synthetic', hasNativeStarted: false },
    prompt: 'hello',
    permissionProfile: 'readonly',
    mode: 'mock'
  });
  assert.match(result.command, /^codex app-server/);
  assert.equal(result.transport, 'codex-app-server');
});

test('Claude and Kimi command builders preserve model, session, and permissions', () => {
  const claude = buildCommand({
    role: { id: 'claude-deep-review', cli: 'claude', command: 'claude', model: 'deepseek-v4-pro' },
    projectPath: '/tmp/project',
    session: { native_session_id: 'claude-session' },
    prompt: 'review this',
    permissionProfile: 'workspace-write'
  });
  assert.equal(claude.command, 'claude');
  assert.deepEqual(claude.args, [
    '-p',
    '--model',
    'deepseek-v4-pro',
    '--session-id',
    'claude-session',
    '--output-format',
    'json',
    '--permission-mode',
    'acceptEdits',
    'review this'
  ]);

  const kimi = buildCommand({
    role: { id: 'kimi-ux-review', cli: 'kimi', command: 'kimi', model: 'kimi-code-cli' },
    projectPath: '/tmp/project',
    session: { native_session_id: 'kimi-session' },
    prompt: 'review ui',
    permissionProfile: 'readonly'
  });
  assert.equal(kimi.command, 'kimi');
  assert.deepEqual(kimi.args, [
    '--work-dir',
    '/tmp/project',
    '--session',
    'kimi-session',
    '--print',
    '--output-format',
    'text',
    '--plan',
    '--prompt',
    'review ui'
  ]);
});

test('Codex app-server params carry model, cwd, permissions, and text input', () => {
  const role = { id: 'codex-manager', cli: 'codex', model: 'gpt-5.5', thinkingLevel: 'high', responsibility: '管理团队' };
  const start = buildCodexAppServerStartParams({
    role,
    projectPath: '/tmp/project',
    permissionProfile: 'write-proposed'
  });
  assert.equal(start.model, 'gpt-5.5');
  assert.equal(start.reasoningEffort, 'high');
  assert.equal(start.cwd, '/tmp/project');
  assert.equal(start.sandbox, 'workspace-write');
  assert.equal(start.approvalPolicy, 'on-request');

  const turn = buildCodexAppServerTurnParams({
    threadId: 'thread-1',
    role,
    projectPath: '/tmp/project',
    prompt: 'hello',
    permissionProfile: 'readonly'
  });
  assert.equal(turn.threadId, 'thread-1');
  assert.deepEqual(turn.input, [{ type: 'text', text: 'hello', text_elements: [] }]);
  assert.equal(turn.reasoningEffort, 'high');
  assert.equal(turn.sandboxPolicy.type, 'readOnly');
  assert.equal(turn.approvalPolicy, 'never');
});

test('generic CLI adapter runs arbitrary configured command with prompt env', async () => {
  const result = await invokeAgent({
    role: {
      id: 'local-generic-review',
      name: 'Local Generic Review',
      cli: 'generic',
      adapter: 'generic-cli',
      commandTemplate: 'printf "generic:%s:%s:%s:" "$AT_AGENT_ROLE_ID" "$AT_AGENT_MODEL" "$AT_AGENT_THINKING_LEVEL"; head -c 5 "$AT_AGENT_PROMPT_FILE"',
      model: 'any-local-model',
      thinkingLevel: 'xhigh'
    },
    project: { path: process.cwd() },
    session: { native_session_id: 'generic-session', hasNativeStarted: false },
    prompt: 'hello from prompt',
    permissionProfile: 'readonly',
    mode: 'real'
  });

  assert.equal(result.ok, true);
  assert.match(result.command, /generic-cli|zsh|bash|sh/);
  assert.equal(result.output, 'generic:local-generic-review:any-local-model:xhigh:hello');
  assert.equal(result.nativeSessionId, 'generic-session');
});

test('invokeAgent only uses mock mode when explicitly passed by runtime', async () => {
  const previous = process.env.AT_TEAM_AGENT_MODE;
  process.env.AT_TEAM_AGENT_MODE = 'mock';
  try {
    const result = await invokeAgent({
      role: {
        id: 'explicit-mode-test',
        name: 'Explicit Mode Test',
        cli: 'generic',
        adapter: 'generic-cli',
        commandTemplate: 'printf "real:%s" "$AT_AGENT_ROLE_ID"',
        model: 'local',
        thinkingLevel: 'low'
      },
      project: { path: process.cwd() },
      session: { native_session_id: 'explicit-session', hasNativeStarted: false },
      prompt: 'hello',
      permissionProfile: 'readonly'
    });
    assert.equal(result.output, 'real:explicit-mode-test');
  } finally {
    if (previous === undefined) delete process.env.AT_TEAM_AGENT_MODE;
    else process.env.AT_TEAM_AGENT_MODE = previous;
  }
});

test('adapter selection can override a built-in Codex cli role', () => {
  const command = buildCommand({
    role: {
      id: 'codex-goal-review',
      cli: 'codex',
      adapter: 'generic-cli',
      commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"'
    },
    projectPath: '/tmp/project',
    session: { native_session_id: 'session', hasNativeStarted: false },
    prompt: 'hello',
    permissionProfile: 'readonly'
  });
  assert.deepEqual(command.args, ['-lc', 'cat "$AT_AGENT_PROMPT_FILE"']);
});

test('agent config updates persist model, adapter, command, and template', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const updated = runtime.updateAgentConfig({
      roleId: 'kimi-ux-review',
      config: {
        model: 'new-ui-model',
        thinkingLevel: 'high',
        adapter: 'generic-cli',
        command: 'zsh',
        commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
        responsibility: '新的 UI/UX 职责',
        defaultPermission: 'write-proposed'
      }
    });
    assert.equal(updated.model, 'new-ui-model');
    assert.equal(updated.thinking_level, 'high');
    assert.equal(updated.adapter, 'generic-cli');
    assert.equal(updated.command, 'zsh');
    assert.equal(updated.command_template, 'cat "$AT_AGENT_PROMPT_FILE"');
    assert.equal(updated.responsibility, '新的 UI/UX 职责');
    assert.equal(updated.default_permission, 'write-proposed');
    const status = runtime.teamStatusSync();
    const kimi = status.agents.find((agent) => agent.id === 'kimi-ux-review');
    assert.equal(kimi.model, 'new-ui-model');
    assert.equal(kimi.thinkingLevel, 'high');
    assert.equal(kimi.adapter, 'generic-cli');
    assert.equal(kimi.commandTemplate, 'cat "$AT_AGENT_PROMPT_FILE"');
    assert.equal(kimi.responsibility, '新的 UI/UX 职责');
  } finally {
    cleanup();
  }
});

test('team defaults update model, thinking level, and default permission across active agents', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const result = runtime.updateTeamConfig({
      roleIds: ['claude-deep-review', 'kimi-ux-review'],
      config: {
        model: 'shared-review-model',
        thinkingLevel: 'low',
        defaultPermission: 'write-proposed'
      }
    });
    assert.equal(result.updated.length, 2);
    const status = runtime.teamStatusSync();
    for (const roleId of ['claude-deep-review', 'kimi-ux-review']) {
      const agent = status.agents.find((item) => item.id === roleId);
      assert.equal(agent.model, 'shared-review-model');
      assert.equal(agent.thinkingLevel, 'low');
      assert.equal(agent.defaultPermission, 'write-proposed');
    }
    assert.ok(status.events.some((event) => event.type === 'team.config.updated'));
  } finally {
    cleanup();
  }
});

test('agent config validation rejects unsupported adapters and incomplete generic cli agents', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    assert.throws(() => runtime.createAgent({
      roleId: 'bad-agent',
      adapter: 'missing-adapter',
      cli: 'generic',
      model: 'local'
    }), /unsupported adapter/);

    assert.throws(() => runtime.createAgent({
      roleId: 'bad-generic',
      adapter: 'generic-cli',
      cli: 'generic',
      commandTemplate: '',
      model: 'local'
    }), /requires commandTemplate/);

    assert.throws(() => runtime.createAgent({
      roleId: 'bad-thinking',
      adapter: 'generic-cli',
      cli: 'generic',
      commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
      model: 'local',
      thinkingLevel: 'galaxy'
    }), /unsupported thinkingLevel/);
  } finally {
    cleanup();
  }
});

test('platform health and export expose registry, sessions, and portable state', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const status = await runtime.platformHealth();
    assert.ok(status.adapters.some((adapter) => adapter.id === 'generic-cli'));
    assert.ok(status.checks.some((check) => check.id === 'adapter-registry' && check.ok));
    assert.ok(status.checks.some((check) => check.id === 'codex-session-split' && check.ok));
    assert.equal(typeof status.counts.recentFailures, 'number');
    assert.equal(typeof status.counts.historicalFailures, 'number');

    const exported = runtime.platformExport(status.project.id);
    assert.equal(exported.format, 'at-agent-team-platform-export/v1');
    assert.ok(exported.agents.some((agent) => agent.role_id === 'codex-manager'));
    assert.ok(exported.sessions.some((session) => session.role_id === 'codex-manager'));
    assert.ok(exported.adapters.some((adapter) => adapter.id === 'codex-app-server'));
  } finally {
    cleanup();
  }
});

test('work items model issues, proposals, reviews, decisions, and manager-linked runs', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const projectId = runtime.teamStatusSync().project.id;
    const issue = runtime.createWorkItem({
      projectId,
      type: 'issue',
      title: 'Make AT feel like a collaboration platform',
      body: '需要 issue/proposal/review 等对象承载 AI 协作。',
      priority: 'high',
      assignedRoleId: 'codex-manager',
      dispatchToManager: true,
      permissionProfile: 'readonly'
    });
    assert.equal(issue.type, 'issue');
    assert.equal(issue.status, 'in-progress');
    assert.equal(issue.priority, 'high');
    assert.ok(issue.linkedRunId);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(runtime.storage.listEvents({ runId: issue.linkedRunId }).some((event) => event.type === 'agent.completed'));

    const proposal = runtime.createWorkItem({
      projectId,
      type: 'proposal',
      title: 'Add Work Board',
      parentId: issue.id,
      assignedRoleId: 'kimi-ux-review'
    });
    assert.equal(proposal.parentId, issue.id);

    const updated = runtime.updateWorkItem({
      projectId,
      id: proposal.id,
      status: 'review',
      priority: 'urgent'
    });
    assert.equal(updated.status, 'review');
    assert.equal(updated.priority, 'urgent');

    const room = runtime.chatRoom(projectId);
    assert.ok(room.workItems.some((item) => item.id === issue.id));
    assert.ok(runtime.platformExport(projectId).workItems.some((item) => item.id === proposal.id));
    const events = runtime.storage.listEvents({ projectId });
    assert.ok(events.some((event) => event.type === 'work.item.created'));
    assert.ok(events.some((event) => event.type === 'work.item.linked_run'));
    assert.ok(events.some((event) => event.type === 'work.item.updated'));

    const otherProject = runtime.createProject({ name: 'Other Project', path: '/tmp/at-other' });
    assert.throws(
      () => runtime.updateWorkItem({ projectId: otherProject.id, id: proposal.id, status: 'closed' }),
      /Work item does not belong to project/
    );
  } finally {
    cleanup();
  }
});

test('team manifest applies idempotently and rejects unsafe partial changes', () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const projectId = runtime.teamStatusSync().project.id;
    const first = runtime.applyTeamManifest({
      projectId,
      manifest: {
        name: 'Runtime manifest test',
        workItems: [{
          type: 'issue',
          title: 'Runtime manifest issue',
          body: 'First apply.'
        }]
      }
    });
    assert.equal(first.applied.workItems[0].manifestExisting, undefined);
    const second = runtime.applyTeamManifest({
      projectId,
      manifest: {
        name: 'Runtime manifest test',
        workItems: [{
          type: 'issue',
          title: 'Runtime manifest issue',
          body: 'Second apply updates instead of duplicating.'
        }]
      }
    });
    assert.equal(second.applied.workItems[0].manifestExisting, true);
    assert.equal(
      runtime.listWorkItems(projectId).workItems.filter((item) => item.metadata?.manifestKey === 'Runtime manifest test:1:issue:Runtime manifest issue').length,
      1
    );

    assert.throws(() => runtime.applyTeamManifest({
      projectId,
      manifest: {
        agents: [{
          roleId: 'unsafe-manifest-agent',
          adapter: 'generic-cli',
          command: 'zsh',
          commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"; echo unsafe',
          model: 'local'
        }]
      }
    }), /dangerousCommandTemplate/);
    assert.ok(!runtime.storage.listAgents({ includeDisabled: true }).some((agent) => agent.role_id === 'unsafe-manifest-agent'));

    assert.throws(() => runtime.applyTeamManifest({
      projectId,
      manifest: {
        defaults: {
          roleIds: ['kimi-ux-review'],
          commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE" | tee /tmp/at-output'
        }
      }
    }), /dangerousCommandTemplate/);

    assert.throws(() => runtime.applyTeamManifest({
      projectId,
      manifest: {
        agents: [{
          roleId: 'rollback-manifest-agent',
          adapter: 'generic-cli',
          command: 'zsh',
          commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
          model: 'local'
        }],
        workItems: [{
          type: 'not-a-real-type',
          title: 'Rollback invalid item'
        }]
      }
    }), /Unsupported work item type/);
    assert.ok(!runtime.storage.listAgents({ includeDisabled: true }).some((agent) => agent.role_id === 'rollback-manifest-agent'));
  } finally {
    cleanup();
  }
});

test('dynamic generic agents can be registered and dispatched in a manager run', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    const agent = runtime.createAgent({
      roleId: 'qwen-architect',
      name: 'Qwen Architect',
      cli: 'generic',
      adapter: 'generic-cli',
      command: 'zsh',
      commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
      model: 'qwen-local',
      responsibility: 'Architecture review.',
      defaultPermission: 'readonly'
    });
    assert.equal(agent.role_id, 'qwen-architect');

    const status = runtime.teamStatusSync();
    assert.ok(status.agents.some((item) => item.id === 'qwen-architect'));

    const run = runtime.createTask({ prompt: '动态 agent 调度测试。' });
    await runtime.dispatchAgent({
      runId: run.id,
      roleId: 'qwen-architect',
      task: '请确认你能收到 manager 分派。',
      permissionProfile: 'readonly'
    });
    const completed = runtime.storage
      .listEvents({ runId: run.id })
      .find((event) => event.type === 'agent.completed' && event.role_id === 'qwen-architect');
    assert.ok(completed);
    assert.match(JSON.parse(completed.payload).output, /mock:qwen-architect/);
  } finally {
    cleanup();
  }
});

test('dynamic agents can be disabled while codex-manager is protected', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    runtime.createAgent({
      roleId: 'temp-local-agent',
      adapter: 'generic-cli',
      cli: 'generic',
      command: 'zsh',
      commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
      model: 'local'
    });
    assert.ok(runtime.teamStatusSync().agents.some((agent) => agent.id === 'temp-local-agent'));

    const disabled = runtime.disableAgent({ roleId: 'temp-local-agent' });
    assert.equal(disabled.enabled, 0);
    assert.ok(!runtime.teamStatusSync().agents.some((agent) => agent.id === 'temp-local-agent'));
    await assert.rejects(() => runtime.dispatchAgent({ roleId: 'temp-local-agent', task: 'x' }), /Unknown role/);
    assert.throws(() => runtime.disableAgent({ roleId: 'codex-manager' }), /cannot be disabled/);
  } finally {
    cleanup();
  }
});

test('agent approval requests are stored as visible team events', async () => {
  const { runtime, cleanup } = withRuntime();
  try {
    runtime.createAgent({
      roleId: 'approval-test-agent',
      adapter: 'event-test',
      cli: 'generic',
      command: 'zsh',
      commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
      model: 'local'
    });
    const run = runtime.createTask({ prompt: 'approval visibility test' });
    await runtime.dispatchAgent({
      runId: run.id,
      roleId: 'approval-test-agent',
      task: 'trigger approval event',
      permissionProfile: 'write-proposed'
    });

    const events = runtime.storage.listEvents({ runId: run.id });
    const approval = events.find((event) => event.type === 'agent.approval.requested');
    assert.ok(approval);
    assert.equal(JSON.parse(approval.payload).autoResponse, 'decline');

    const completed = events.find((event) => event.type === 'agent.completed' && event.role_id === 'approval-test-agent');
    assert.deepEqual(JSON.parse(completed.payload).autoResponses, [
      { method: 'test/requestApproval', requestId: 'test-approval-1', autoResponse: 'decline' }
    ]);
  } finally {
    cleanup();
  }
});
