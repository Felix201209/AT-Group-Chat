import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  GitPullRequest,
  KeyRound,
  ListChecks,
  MessageSquare,
  Moon,
  PlugZap,
  Play,
  ShieldCheck,
  Sun,
  Terminal,
} from 'lucide-react';
import { api, eventStreamUrl } from './apiClient.js';
import { Sidebar } from './components/AppShell.jsx';
import { DEFAULT_CHAT_PROMPT, MANAGER_ROLE_ID } from './constants.js';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { useHashRoute } from './hooks/useHashRoute.js';
import { compactText, eventChatText, formatDateTime, formatTime, parsePayload, readStoredValue, writeStoredValue } from './uiFormatters.js';
import { permissionLabels, roleIcons, storageKeys, thinkingLabels, workPriorityLabels, workStatusLabels, workTypeLabels } from './uiLabels.js';
import './styles/index.css';

function PlatformView({ status, platform }) {
  const checks = platform?.checks || [];
  const adapters = status.adapters || platform?.adapters || [];
  const setup = platform?.setup || {};
  const [now, setNow] = useState(() => new Date());
  const completionCutoff = new Date('2026-05-17T07:30:00+08:00');
  const completionEligible = now.getTime() >= completionCutoff.getTime();
  const counts = platform?.counts || {
    activeAgents: status.agents.length,
    runs: status.runs?.length || 0,
    recentEvents: status.events?.length || 0,
    recentFailures: (status.events || []).filter((event) => event.type === 'agent.failed').length
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="view-page platform-page">
      <div className="view-header">
        <span>Platform</span>
        <strong>本地 Agent Runtime 控制平面</strong>
      </div>

      <section className="start-panel" aria-label="AT first run guide">
        <div className="start-copy">
          <span>Start here</span>
          <strong>不是另一个 Slack，也不是另一个 Jira。</strong>
          <p>AT 把一次 AI 协作变成可追踪链路：群聊负责上下文，Manager 负责点名，Work 负责 issue / proposal / review / decision，事件日志负责审计。</p>
        </div>
        <div className="start-steps" aria-label="first steps">
          <article>
            <strong>1</strong>
            <span>在 Chat 发一个真实任务。</span>
          </article>
          <article>
            <strong>2</strong>
            <span>Manager 先判断是否需要专家。</span>
          </article>
          <article>
            <strong>3</strong>
            <span>把结论沉淀成 Work Item 和审计记录。</span>
          </article>
        </div>
      </section>

      <div className="platform-readiness">
        <article>
          <span>runtime</span>
          <strong>{platform?.ok ? 'ready' : 'checking'}</strong>
          <p>{status.codexCliServer?.kind} · {status.codexCliServer?.connected ? 'connected' : 'offline'}</p>
        </article>
        <article>
          <span>agents</span>
          <strong>{counts.activeAgents}</strong>
          <p>active roles · {counts.disabledAgents || 0} disabled</p>
        </article>
        <article>
          <span>events</span>
          <strong>{counts.recentEvents}</strong>
          <p>{counts.recentFailures} failures in 24h · {counts.historicalFailures || 0} historical</p>
        </article>
        <article>
          <span>adapters</span>
          <strong>{adapters.length}</strong>
          <p>server, native CLI, generic CLI</p>
        </article>
        <article>
          <span>completion gate</span>
          <strong>{completionEligible ? 'eligible' : 'locked'}</strong>
          <p>now {formatDateTime(now)} Asia/Shanghai · final audit after 2026-05-17 07:30 CST</p>
        </article>
      </div>

      <div className="platform-grid">
        <section className="settings-block setup-checklist">
          <div className="timeline-head">
            <strong>Setup Checklist</strong>
            <span>第一次跑通先看这里</span>
          </div>
          {[
            ['Codex server', setup.codexServer?.connected, setup.codexServer?.command || status.codexCliServer?.command],
            ['API token', setup.authEnabled, setup.authEnabled ? '已启用本地 token' : '未启用；仅建议本机开发时这样用'],
            ['Agent mode', setup.agentMode === 'real', setup.agentMode || 'real'],
            ['CLI roles', setup.cliAvailability?.codex || setup.cliAvailability?.generic, 'Codex / Claude / Kimi / Generic adapter'],
            ['Data path', true, setup.dataPath || 'data/at-team.sqlite']
          ].map(([label, ok, description]) => (
            <article key={label} className={ok ? 'setup-item ok' : 'setup-item warn'}>
              <CheckCircle2 size={16} />
              <div>
                <strong>{label}</strong>
                <span>{description}</span>
              </div>
            </article>
          ))}
        </section>

        <section className="settings-block trust-block">
          <div className="timeline-head">
            <strong>Trust Boundary</strong>
            <span>默认本机、默认可看见、默认可收回</span>
          </div>
          <div className="trust-list">
            <article>
              <ShieldCheck size={17} />
              <div>
                <strong>本地优先</strong>
                <span>UI、API、Codex server 都跑在 localhost；外部访问时建议启用 AT_TEAM_API_TOKEN。</span>
              </div>
            </article>
            <article>
              <KeyRound size={17} />
              <div>
                <strong>权限闸门</strong>
                <span>每次 dispatch 都带 permission profile；危险权限必须被明确选择。</span>
              </div>
            </article>
            <article>
              <GitPullRequest size={17} />
              <div>
                <strong>人类仍是最终 reviewer</strong>
                <span>Agent review 是证据和建议，不替代公司流程里的人工 approval。</span>
              </div>
            </article>
          </div>
        </section>

        <section className="settings-block">
          <div className="timeline-head">
            <strong>Readiness Gates</strong>
            <span>hard platform checks</span>
          </div>
          <div className="gate-list">
            {checks.map((check) => (
              <article key={check.id} className={check.ok ? 'gate ok' : 'gate fail'}>
                <CheckCircle2 size={16} />
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.ok ? 'pass' : 'needs attention'}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="settings-block">
          <div className="timeline-head">
            <strong>Proof & ROI</strong>
            <span>能向团队解释它做了什么</span>
          </div>
          <div className="roi-grid">
            <article>
              <strong>{counts.runs}</strong>
              <span>manager runs</span>
            </article>
            <article>
              <strong>{counts.recentEvents}</strong>
              <span>recent audit events</span>
            </article>
            <article>
              <strong>{counts.recentFailures}</strong>
              <span>recent failures</span>
            </article>
          </div>
          <a className="export-link" href="/api/platform/export" download="at-platform-export.json">
            Export portable state
          </a>
          <div className="platform-code-list">
            <code>GET /api/platform</code>
            <code>GET /api/platform/export</code>
            <code>GET /api/adapters</code>
            <code>GET /api/chat</code>
            <code>POST /api/chat/messages</code>
            <code>npm run preflight</code>
            <code>npm run health</code>
            <code>npm run smoke:manager</code>
            <code>npm run verify</code>
            <code>npm run verify:complete</code>
            <code>npm run audit</code>
            <code>npm run audit:complete</code>
          </div>
        </section>
      </div>

      <section className="settings-block">
        <div className="timeline-head">
          <strong>Adapter Registry</strong>
          <span>任何模型通过 adapter 接入</span>
        </div>
        <div className="adapter-registry">
          {adapters.map((adapter) => (
            <article key={adapter.id}>
              <div>
                <strong>{adapter.label}</strong>
                <span>{adapter.id}</span>
              </div>
              <p>{adapter.description}</p>
              <dl>
                <dt>transport</dt>
                <dd>{adapter.transport}</dd>
                <dt>memory</dt>
                <dd>{adapter.memory}</dd>
                <dt>models</dt>
                <dd>{adapter.models}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function Topbar({ prompt, setPrompt, permission, setPermission, onRun, busy }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span>本地 Agent Team 面板</span>
        <strong>Agent Team</strong>
      </div>
      <div className="task-input">
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="给 codex-manager 一个任务，让它决定是否调度其他岗位..."
        />
        <select value={permission} onChange={(event) => setPermission(event.target.value)}>
          {Object.entries(permissionLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="primary" onClick={onRun} disabled={busy || !prompt.trim()}>
          <Play size={16} />
          {busy ? '运行中' : '发送'}
        </button>
      </div>
    </header>
  );
}

function avatarLabel(agent) {
  if (!agent?.name) return '?';
  return agent.name
    .split(/\s|\+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function GroupChatPanel({
  agents,
  events,
  room,
  activeRunId,
  connectionState,
  showSystemEvents,
  setShowSystemEvents,
  onDispatch,
  selectedRoleId,
  onSelect,
  prompt,
  setPrompt,
  permission,
  setPermission,
  onRun,
  onStarterTask,
  busy
}) {
  const streamRef = useRef(null);
  const byId = Object.fromEntries((agents || []).map((agent) => [agent.id, agent]));
  const roomMessages = room?.messages || [];
  const chatMessages = roomMessages.slice(-24).map((message) => {
    const isUser = message.speaker === 'human' || message.direction === 'user';
    const agent = isUser
      ? { id: 'user', name: 'You', accent: '#172033' }
      : byId[message.roleId] || byId[MANAGER_ROLE_ID] || { id: message.roleId, name: message.roleId, accent: '#64748b' };
    const prefix = message.direction === 'manager-dispatch' ? 'Manager dispatch: ' : '';
    return {
      id: message.id,
      agent,
      text: compactText(`${prefix}${message.content}`, message.direction === 'assistant' ? 260 : 180),
      side: isUser ? 'user' : 'agent',
      created_at: message.createdAt,
      direction: message.direction
    };
  });
  const chatEvents = showSystemEvents ? (events || []).slice(-14).map((event) => {
    const payload = parsePayload(event.payload);
    const agent =
      event.type === 'run.created'
        ? { id: 'user', name: 'You', accent: '#172033' }
        : byId[event.role_id] || byId[payload.roleId] || byId[MANAGER_ROLE_ID];
    const isUser = event.type === 'run.created';
    const text = eventChatText(event, payload);
    return {
      ...event,
      agent,
      text: compactText(text, event.type === 'agent.completed' ? 220 : 150),
      side: isUser ? 'user' : 'agent'
    };
  }) : [];
  const chatItems = [...chatMessages, ...chatEvents].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime() || 0;
    const tb = new Date(b.created_at || 0).getTime() || 0;
    return ta - tb;
  });

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }, [chatItems.length, activeRunId]);

  return (
    <section className="group-chat">
      <div className="chat-header">
        <div>
          <span>AI Collaboration Room</span>
          <strong>AT AI 合作群聊</strong>
        </div>
        <div className="group-meta">
          <span className={`connection-pill ${connectionState || 'idle'}`}>
            {connectionState === 'live' ? 'live' : connectionState === 'reconnecting' ? 'reconnecting' : activeRunId ? 'connecting' : 'idle'}
          </span>
          <label className="system-toggle">
            <input
              type="checkbox"
              checked={showSystemEvents}
              onChange={(event) => setShowSystemEvents(event.target.checked)}
            />
            系统事件
          </label>
          <div className="avatar-stack">
            {(agents || []).map((agent) => (
              <button
                key={agent.id}
                className={selectedRoleId === agent.id ? 'mini-avatar active' : 'mini-avatar'}
                style={{ '--accent': agent.accent }}
                onClick={() => onSelect(agent.id)}
                title={agent.name}
                type="button"
              >
                {avatarLabel(agent)}
              </button>
            ))}
          </div>
          <small>{activeRunId ? `run ${activeRunId.slice(0, 8)}` : `${agents?.length || 0} members in AT`}</small>
        </div>
      </div>
      <div className="chat-roster" aria-label="群聊成员">
        {(agents || []).map((agent) => (
          <button
            key={agent.id}
            className={selectedRoleId === agent.id ? 'roster-chip active' : 'roster-chip'}
            style={{ '--accent': agent.accent }}
            onClick={() => onSelect(agent.id)}
            type="button"
          >
            <span />
            {agent.name}
          </button>
        ))}
      </div>
      <div className="chat-room-state" aria-label="群聊调度状态">
        <span>Manager 控制</span>
        <span>共享记录</span>
        <span>不自动循环</span>
      </div>
      <div className="chat-stream" aria-label="Agent group chat transcript" ref={streamRef}>
        {chatItems.length ? (
          chatItems.map((item) => (
            <article
              className={`chat-message ${item.side}`}
              style={{ '--accent': item.agent?.accent || '#64748b' }}
              key={`${item.type ? 'event' : 'message'}:${item.id}`}
            >
              <div className="chat-avatar">{avatarLabel(item.agent)}</div>
              <div className="message-stack">
                <div className="chat-meta-line">
                  <strong>{item.agent?.name || item.role_id || 'system'}</strong>
                  <time>{formatTime(item.created_at)}</time>
                </div>
                <p>{item.text}</p>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-chat">
            <MessageSquare size={20} />
            <strong>这里会显示所有 agent 的共享聊天记录</strong>
            <span>先在 AT 群里发消息，Manager 再点名其他 AI 成员回复。</span>
            <div className="starter-tasks" aria-label="starter tasks">
              {[
                ['审查当前项目', '请作为 manager 审查当前项目：它是否已经像一个本地 AI 协作平台？请只给下一步建议。'],
                ['创建 issue', '请作为 manager 把“首次成功路径还不够清晰”转成一个 AT issue，并建议是否需要 review。'],
                ['外部 agent 接入', '请作为 manager 说明一个外部 agent 应如何通过 HTTP/MCP 接入 AT 并遵守单点调度。']
              ].map(([label, text]) => (
                <button key={label} className="ghost compact" type="button" onClick={() => onStarterTask(text)} disabled={busy}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mention-bar">
        <span>快速点名</span>
        {(agents || []).filter((agent) => agent.id !== MANAGER_ROLE_ID).map((agent) => (
          <button key={agent.id} className="ghost compact" disabled={!activeRunId} onClick={() => onDispatch(agent.id)} type="button">
            <ChevronRight size={14} />
            @{agent.name}
          </button>
        ))}
      </div>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onRun();
        }}
      >
        <select value={permission} onChange={(event) => setPermission(event.target.value)} aria-label="权限闸门">
          {Object.entries(permissionLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <textarea
          rows={2}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!busy && prompt.trim()) onRun();
            }
          }}
          placeholder="发到 AT 群聊，让 Manager 决定是否点名其他 AI 成员..."
        />
        <button className="primary" disabled={busy || !prompt.trim()} type="submit">
          <Play size={16} />
          {busy ? '发送中' : '发送'}
        </button>
      </form>
    </section>
  );
}

function AgentLane({ agent, selected, onSelect, onPermissionChange, onDispatch, activeRunId }) {
  const Icon = roleIcons[agent.id] || Bot;
  const session = agent.session || {};
  const last = agent.lastMessages?.at(-1);
  return (
    <section
      className={selected ? 'agent-lane selected' : 'agent-lane'}
      style={{ '--accent': agent.accent }}
      onClick={() => onSelect(agent.id)}
    >
      <div className="lane-head">
        <div className="role-icon">
          <Icon size={19} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.id}</span>
        </div>
        <div className="health">
          <Activity size={14} />
          online
        </div>
      </div>

      <p className="responsibility">{compactText(agent.responsibility, 52)}</p>

      <div className="lane-grid">
        <div>
          <span>CLI</span>
          <strong>{agent.cli}</strong>
        </div>
        <div>
          <span>模型</span>
          <strong>{agent.model}</strong>
        </div>
        <div>
          <span>Thinking</span>
          <strong>{agent.thinkingLevel || 'medium'}</strong>
        </div>
        <div>
          <span>多轮记忆</span>
          <strong>项目 + 岗位</strong>
        </div>
        <div>
          <span>权限闸门</span>
          <select
            value={session.permission_profile || agent.defaultPermission}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onPermissionChange(agent.id, event.target.value)}
          >
            {Object.entries(permissionLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="session-box">
        <span>native session id</span>
        <code>{session.native_session_id}</code>
      </div>

      <div className="transcript-preview">
        <span>最近回复</span>
        <p>{compactText(last?.content, 120) || '等待 manager 分派第一条任务。'}</p>
      </div>

      <button
        className="ghost"
        disabled={!activeRunId || agent.id === MANAGER_ROLE_ID}
        onClick={(event) => {
          event.stopPropagation();
          onDispatch(agent.id);
        }}
      >
        <ChevronRight size={15} />
        Manager 点名此岗位
      </button>
    </section>
  );
}

function Inspector({ agent, project, memory, activeRunId }) {
  if (!agent) return null;
  const endpoint = agent.id === MANAGER_ROLE_ID ? 'POST /api/runs' : `POST /api/runs/${activeRunId || ':runId'}/dispatch`;
  const resumeCommand =
    agent.cli === 'codex'
      ? `codex app-server thread/resume ${agent.session?.native_session_id || '<thread>'}`
      : agent.cli === 'claude'
        ? `claude -p --model ${agent.model} --session-id ${agent.session?.native_session_id || '<session>'}`
        : `kimi --session ${agent.session?.native_session_id || '<session>'} --print`;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <span>选中岗位</span>
          <strong>{agent.name}</strong>
        </div>
        <ShieldCheck size={20} />
      </div>
      <div className="rule-box">
        <strong>调度规则</strong>
        <p>所有 agent 都能看到 team transcript，但只有 Codex Manager 能决定下一位 agent 是否活动。自由讨论和自动循环触发关闭。</p>
      </div>
      <dl>
        <dt>HTTP endpoint</dt>
        <dd>{endpoint}</dd>
        <dt>MCP tool</dt>
        <dd>{agent.mcpTool}</dd>
        <dt>恢复会话</dt>
        <dd>
          <code>{resumeCommand}</code>
        </dd>
        <dt>项目记忆</dt>
        <dd>{project?.name} / {agent.id}</dd>
      </dl>
      <div className="memory-list">
        <strong>岗位会话</strong>
        {(memory?.messages || agent.lastMessages || []).slice(-8).map((message) => (
          <article key={message.id || `${message.created_at}-${message.direction}`}>
            <span>{message.direction}</span>
            <p>{message.content}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}

function EventTimeline({ events }) {
  return (
    <section className="timeline">
      <div className="timeline-head">
        <strong>事件时间线</strong>
        <span>handoff / approval / stream / artifact</span>
      </div>
      <div className="timeline-list">
        {events.slice(-18).reverse().map((event) => (
          <article key={event.id}>
            <time>{formatTime(event.created_at)}</time>
            <strong>{event.type}</strong>
            <span>{event.role_id || 'system'}</span>
            <p>{event.payload}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ApiPanel({ activeRunId, project }) {
  const curlExample = `curl -X POST http://127.0.0.1:5174/api/chat/messages -H 'content-type: application/json' -d '${JSON.stringify({
    projectId: project?.id || ':projectId',
    content: '让 manager 审查当前实现，并决定是否点名其他 AI 成员。'
  })}'`;
  const hookExample = `curl -X POST http://127.0.0.1:5174/api/hooks/events -H 'content-type: application/json' -d '${JSON.stringify({
    source: 'ci',
    event: 'test.failed',
    type: 'issue',
    title: 'CI failed',
    dispatchToManager: true
  })}'`;
  return (
    <section className="api-panel">
      <div>
        <Terminal size={17} />
        <strong>Developer Control Plane</strong>
        <span>CLI / SDK / OpenAPI / Webhook / MCP 共用同一套 runtime</span>
      </div>
      <code>at-group-chat chat "让 manager 审查当前项目"</code>
      <code>at-group-chat issue "发布前审查" --body "检查 API/SDK/CLI" --dispatch</code>
      <code>at-group-chat hook --source ci --event test.failed --title "CI failed" --dispatch</code>
      <code>at-group-chat apply-manifest --file at.team.json</code>
      <code>import {'{ createATClient }'} from 'at-group-chat/sdk'</code>
      <code>GET /api/openapi.json  # OpenAPI contract，可生成客户端或 agent tool schema</code>
      <code>POST /api/chat/messages  # AT AI 合作群聊入口</code>
      <code>POST /api/work-items  # issue / proposal / review / decision / artifact</code>
      <code>POST /api/hooks/events  # GitHub Actions / CI / lint / external-agent webhook</code>
      <code>POST /api/team/manifest  # Team as Code: defaults / agents / seed work items</code>
      <code>GET /api/chat  # room, participants, transcript</code>
      <code>{curlExample}</code>
      <code>{hookExample}</code>
      <code>npm run mcp  # tools: team_chat_message, team_get_room, team_create_work_item, team_get_work_items, team_dispatch_agent</code>
      <code>EventSource: /api/runs/{activeRunId || ':runId'}/events</code>
    </section>
  );
}

function InteractionModes({ project, codexCliServer }) {
  const managerPayload = JSON.stringify(
    {
      projectId: project?.id || ':projectId',
      content: '你现在作为 manager，读取 team 状态后决定要不要调度其他岗位。',
      permissionProfile: 'write-proposed'
    },
    null,
    2
  );

  return (
    <section className="interaction-modes">
      <article>
        <div className="mode-icon">
          <MessageSquare size={18} />
        </div>
        <div>
          <span>入口 1</span>
          <strong>上方聊天框</strong>
          <p>人在 UI 顶部输入任务，任务进入 `codex-manager`。Manager 先回复，再由你或 manager 决定是否点名其他岗位。</p>
        </div>
      </article>
      <article>
        <div className="mode-icon">
          <PlugZap size={18} />
        </div>
        <div>
          <span>入口 2</span>
          <strong>外部 agent 调 API 当 manager</strong>
          <p>Qwen、Codex、Claude、Kimi 等任意 agent 可调用 HTTP/MCP。Manager 身份不固定，但必须遵守“单点调度、共享 transcript、不自动循环”。</p>
          <code>POST /api/chat/messages {managerPayload}</code>
        </div>
      </article>
      <article className="server-mode">
        <div className="mode-icon">
          <Terminal size={18} />
        </div>
        <div>
          <span>Codex App Server</span>
          <strong>{codexCliServer?.connected ? '已连接' : '未连接'}</strong>
          <p>项目启动时自动打开 `codex app-server`，Codex 岗位通过长期 server 协议执行，不走 `codex exec`。</p>
          <code>{codexCliServer?.command || 'codex app-server --listen ws://127.0.0.1:5176'}</code>
        </div>
      </article>
    </section>
  );
}

function TeamView({
  status,
  activeRunId,
  selectedAgent,
  selectedRoleId,
  setSelectedRoleId,
  updatePermission,
  dispatchRole,
  memory
}) {
  return (
    <>
      <div className="policy-strip compact-strip">
        <span>共享 transcript</span>
        <span>Manager 点名制</span>
        <span>多轮记忆: 项目 + 岗位</span>
        <span>自由讨论 / 无限循环: 关</span>
      </div>
      <div className="workbench">
        <section className="team-board">
          {status.agents.map((agent) => (
            <AgentLane
              key={agent.id}
              agent={agent}
              selected={selectedAgent?.id === agent.id}
              activeRunId={activeRunId}
              onSelect={setSelectedRoleId}
              onPermissionChange={updatePermission}
              onDispatch={dispatchRole}
            />
          ))}
        </section>
        <Inspector agent={selectedAgent} project={status.project} memory={memory} activeRunId={activeRunId} />
      </div>
    </>
  );
}

function ChatView({
  status,
  room,
  prompt,
  setPrompt,
  permission,
  setPermission,
  runTask,
  runStarterTask,
  busy,
  activeRunId,
  connectionState,
  showSystemEvents,
  setShowSystemEvents,
  selectedRoleId,
  setSelectedRoleId,
  dispatchRole
}) {
  return (
    <>
      <div className="policy-strip compact-strip">
        <span>Chat 入口</span>
        <span>Manager 控制下一位</span>
        <span>所有 agent 可见共享记录</span>
        <span>不自由讨论 / 不自动循环</span>
      </div>
      <GroupChatPanel
        agents={status.agents}
        events={status.events || []}
        room={room}
        activeRunId={activeRunId}
        connectionState={connectionState}
        showSystemEvents={showSystemEvents}
        setShowSystemEvents={setShowSystemEvents}
        onDispatch={dispatchRole}
        selectedRoleId={selectedRoleId}
        onSelect={setSelectedRoleId}
        prompt={prompt}
        setPrompt={setPrompt}
        permission={permission}
        setPermission={setPermission}
        onRun={runTask}
        onStarterTask={runStarterTask}
        busy={busy}
      />
    </>
  );
}

function NewWorkItemForm({ agents, onCreate }) {
  const [type, setType] = useState('issue');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assignedRoleId, setAssignedRoleId] = useState('');
  const [dispatchToManager, setDispatchToManager] = useState(true);
  const canCreate = title.trim().length > 0;

  async function submit() {
    const created = await onCreate({
      type,
      title: title.trim(),
      body,
      priority,
      assignedRoleId: assignedRoleId || null,
      dispatchToManager
    });
    if (created) {
      setTitle('');
      setBody('');
      setAssignedRoleId('');
      setDispatchToManager(true);
    }
  }

  return (
    <section className="work-intake">
      <div className="timeline-head">
        <strong>新建协作对象</strong>
        <span>issue / proposal / review，而不是把任务散落在聊天里</span>
      </div>
      <div className="work-form-grid">
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="work item type">
          {Object.entries(workTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题，例如：接入 Qwen provider 的 review 流程" aria-label="work item title" />
        <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="work item priority">
          {Object.entries(workPriorityLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={assignedRoleId} onChange={(event) => setAssignedRoleId(event.target.value)} aria-label="work item assignee">
          <option value="">未指定 owner</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="背景、验收标准、需要哪个 agent 审查..." aria-label="work item body" />
        <label className="inline-toggle">
          <input type="checkbox" checked={dispatchToManager} onChange={(event) => setDispatchToManager(event.target.checked)} />
          <span>创建后交给 Manager</span>
        </label>
        <button className="primary" type="button" disabled={!canCreate} onClick={submit}>
          创建 Work Item
        </button>
      </div>
    </section>
  );
}

function WorkItemCard({ item, agents, onUpdate, onOpenWithManager, onCreateReviewRequest, onOpenDetail }) {
  const assignee = agents.find((agent) => agent.id === item.assignedRoleId);
  return (
    <article className={`work-card ${item.status}`}>
      <div className="work-card-head">
        <span>{workTypeLabels[item.type] || item.type}</span>
        <code>#{item.id.slice(0, 8)}</code>
      </div>
      <strong>{item.title}</strong>
      {item.body ? <p>{compactText(item.body, 180)}</p> : null}
      <div className="work-meta-row">
        <span>{workPriorityLabels[item.priority] || item.priority}</span>
        <span>{assignee?.name || 'No owner'}</span>
        {item.linkedRunId ? <code>run {item.linkedRunId.slice(0, 8)}</code> : null}
      </div>
      <div className="work-card-actions">
        <select value={item.status} onChange={(event) => onUpdate(item.id, { status: event.target.value })} aria-label={`${item.id} status`}>
          {Object.entries(workStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={item.assignedRoleId || ''} onChange={(event) => onUpdate(item.id, { assignedRoleId: event.target.value || null })} aria-label={`${item.id} assignee`}>
          <option value="">Owner</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
        <button className="ghost compact" type="button" onClick={() => onOpenWithManager(item)}>
          交给 Manager
        </button>
        <button className="ghost compact" type="button" onClick={() => onCreateReviewRequest(item)}>
          生成 Review
        </button>
        <button className="ghost compact" type="button" onClick={() => onOpenDetail(item.id)}>
          Activity
        </button>
      </div>
    </article>
  );
}

function WorkItemActivityPanel({ activity, onClose, onOpenWithManager, onCreateReviewRequest }) {
  if (!activity?.item) return null;
  const { item, relatedItems = [], messages = [], events = [] } = activity;
  return (
    <aside className="work-activity">
      <div className="timeline-head">
        <div>
          <strong>{item.title}</strong>
          <span>#{item.id.slice(0, 8)} · {workTypeLabels[item.type] || item.type}</span>
        </div>
        <button className="ghost compact" type="button" onClick={onClose}>关闭</button>
      </div>
      <p>{item.body || '这个 work item 还没有正文。'}</p>
      <div className="work-card-actions">
        <button className="primary compact-action" type="button" onClick={() => onOpenWithManager(item)}>交给 Manager</button>
        <button className="ghost compact" type="button" onClick={() => onCreateReviewRequest(item)}>生成 Review Request</button>
      </div>
      <div className="activity-section">
        <strong>Related Items</strong>
        {relatedItems.map((related) => (
          <article key={related.id}>
            <span>{workTypeLabels[related.type] || related.type} / {related.status}</span>
            <p>{related.title}</p>
          </article>
        ))}
      </div>
      <div className="activity-section">
        <strong>Messages</strong>
        {messages.length ? messages.slice(-8).map((message) => (
          <article key={message.id}>
            <span>{message.roleId} / {message.direction}</span>
            <p>{compactText(message.content, 180)}</p>
          </article>
        )) : <small>暂无 linked run 消息。</small>}
      </div>
      <div className="activity-section">
        <strong>Events</strong>
        {events.slice(-10).map((event) => (
          <article key={event.id}>
            <span>{event.type}</span>
            <p>{compactText(event.payload, 180)}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}

function WorkBoardView({
  status,
  room,
  activeWorkItemId,
  workActivity,
  onCreateWorkItem,
  onUpdateWorkItem,
  onOpenWorkItemWithManager,
  onCreateReviewRequest,
  onOpenWorkItemDetail,
  onCloseWorkItemDetail
}) {
  const workItems = room?.workItems || [];
  const byType = Object.keys(workTypeLabels).map((type) => ({
    type,
    items: workItems.filter((item) => item.type === type)
  }));

  return (
    <section className="view-page work-page">
      <div className="view-header">
        <span>Work</span>
        <strong>AT 协作对象板</strong>
      </div>
      <div className="policy-strip compact-strip">
        <span>Issue = 要解决的问题</span>
        <span>Proposal / PR = 可评审方案</span>
        <span>Review = agent 审查意见</span>
        <span>Decision / Artifact = 可追踪结论</span>
      </div>
      <NewWorkItemForm agents={status.agents} onCreate={onCreateWorkItem} />
      <div className={activeWorkItemId ? 'work-layout has-detail' : 'work-layout'}>
        <div className="work-board">
          {byType.map(({ type, items }) => (
            <section className="work-column" key={type}>
              <div className="work-column-head">
                <ListChecks size={16} />
                <strong>{workTypeLabels[type]}</strong>
                <span>{items.length}</span>
              </div>
              {items.length ? (
                items.map((item) => (
                  <WorkItemCard
                    key={item.id}
                    item={item}
                    agents={status.agents}
                    onUpdate={onUpdateWorkItem}
                    onOpenWithManager={onOpenWorkItemWithManager}
                    onCreateReviewRequest={onCreateReviewRequest}
                    onOpenDetail={onOpenWorkItemDetail}
                  />
                ))
              ) : (
                <div className="empty-column">暂无 {workTypeLabels[type]}</div>
              )}
            </section>
          ))}
        </div>
        {activeWorkItemId ? (
          <WorkItemActivityPanel
            activity={workActivity}
            onClose={onCloseWorkItemDetail}
            onOpenWithManager={onOpenWorkItemWithManager}
            onCreateReviewRequest={onCreateReviewRequest}
          />
        ) : null}
      </div>
    </section>
  );
}

function ProjectView({ status }) {
  return (
    <section className="view-page">
      <div className="view-header">
        <span>项目</span>
        <strong>{status.project?.name || 'AT Group Chat'}</strong>
      </div>
      <div className="detail-grid">
        <article>
          <span>项目路径</span>
          <code>{status.project?.path}</code>
        </article>
        <article>
          <span>团队规模</span>
          <strong>{status.agents.length} 个岗位会话</strong>
        </article>
        <article>
          <span>Codex App Server</span>
          <strong>{status.codexCliServer?.connected ? '已连接' : '未连接'}</strong>
          <code>{status.codexCliServer?.command}</code>
        </article>
        <article>
          <span>调度模式</span>
          <strong>manager-controlled</strong>
          <p>其他岗位只在被 manager 点名时活动，所有回复进入共享 transcript。</p>
        </article>
      </div>
    </section>
  );
}

function SessionsView({ status, selectedRoleId, setSelectedRoleId, updatePermission }) {
  return (
    <section className="view-page">
      <div className="view-header">
        <span>Sessions</span>
        <strong>四条独立多轮记忆</strong>
      </div>
      <div className="session-table">
        {status.agents.map((agent) => (
          <article
            key={agent.id}
            className={selectedRoleId === agent.id ? 'session-row selected' : 'session-row'}
            onClick={() => setSelectedRoleId(agent.id)}
            style={{ '--accent': agent.accent }}
          >
            <div>
              <strong>{agent.name}</strong>
              <span>{agent.id}</span>
            </div>
            <code>{agent.session?.native_session_id}</code>
            <select
              value={agent.session?.permission_profile || agent.defaultPermission}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updatePermission(agent.id, event.target.value)}
            >
              {Object.entries(permissionLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </article>
        ))}
      </div>
    </section>
  );
}

function ApiView({ status, activeRunId }) {
  return (
    <section className="view-page">
      <div className="view-header">
        <span>API</span>
        <strong>外部 agent 可直接当 manager</strong>
      </div>
      <InteractionModes project={status.project} codexCliServer={status.codexCliServer} />
      <ApiPanel activeRunId={activeRunId} project={status.project} />
      <EventTimeline events={status.events || []} />
    </section>
  );
}

function AgentConfigEditor({ agent, onSave, onDisable }) {
  const [name, setName] = useState(agent.name);
  const [model, setModel] = useState(agent.model);
  const [thinkingLevel, setThinkingLevel] = useState(agent.thinkingLevel || agent.thinking_level || 'medium');
  const [adapter, setAdapter] = useState(agent.adapter || agent.cli);
  const [command, setCommand] = useState(agent.command || agent.cli);
  const [commandTemplate, setCommandTemplate] = useState(agent.commandTemplate || agent.command_template || '');
  const [defaultPermission, setDefaultPermission] = useState(agent.defaultPermission || agent.default_permission || 'readonly');
  const [responsibility, setResponsibility] = useState(agent.responsibility || '');

  useEffect(() => {
    setName(agent.name);
    setModel(agent.model);
    setThinkingLevel(agent.thinkingLevel || agent.thinking_level || 'medium');
    setAdapter(agent.adapter || agent.cli);
    setCommand(agent.command || agent.cli);
    setCommandTemplate(agent.commandTemplate || agent.command_template || '');
    setDefaultPermission(agent.defaultPermission || agent.default_permission || 'readonly');
    setResponsibility(agent.responsibility || '');
  }, [agent.id, agent.name, agent.model, agent.thinkingLevel, agent.thinking_level, agent.adapter, agent.command, agent.commandTemplate, agent.command_template, agent.cli, agent.defaultPermission, agent.default_permission, agent.responsibility]);

  return (
    <article className="agent-config-row" style={{ '--accent': agent.accent }}>
      <div className="config-title">
        <strong>{agent.name}</strong>
        <span>{agent.id}</span>
      </div>
      <label>
        <span>显示名</span>
        <input value={name} onChange={(event) => setName(event.target.value)} aria-label={`${agent.id} name`} />
      </label>
      <label>
        <span>模型</span>
        <input value={model} onChange={(event) => setModel(event.target.value)} aria-label={`${agent.id} model`} />
      </label>
      <label>
        <span>Thinking</span>
        <select value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value)} aria-label={`${agent.id} thinking level`}>
          {Object.entries(thinkingLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>默认权限</span>
        <select value={defaultPermission} onChange={(event) => setDefaultPermission(event.target.value)} aria-label={`${agent.id} default permission`}>
          {Object.entries(permissionLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Adapter</span>
        <input value={adapter} onChange={(event) => setAdapter(event.target.value)} aria-label={`${agent.id} adapter`} />
      </label>
      <label>
        <span>命令</span>
        <input value={command} onChange={(event) => setCommand(event.target.value)} aria-label={`${agent.id} command`} />
      </label>
      <label className="wide-field">
        <span>职责</span>
        <textarea value={responsibility} onChange={(event) => setResponsibility(event.target.value)} aria-label={`${agent.id} responsibility`} />
      </label>
      <label className="wide-field">
        <span>command template</span>
        <textarea value={commandTemplate} onChange={(event) => setCommandTemplate(event.target.value)} aria-label={`${agent.id} command template`} />
      </label>
      <div className="config-actions">
        <button
          className="ghost compact"
          type="button"
          onClick={() => onSave(agent.id, { name, model, thinkingLevel, defaultPermission, adapter, command, commandTemplate, responsibility })}
        >
          保存
        </button>
        <button className="ghost compact danger-text" type="button" disabled={agent.id === MANAGER_ROLE_ID} onClick={() => onDisable(agent.id)}>
          禁用
        </button>
      </div>
    </article>
  );
}

function NewAgentForm({ onCreate }) {
  const [roleId, setRoleId] = useState('');
  const [name, setName] = useState('');
  const [model, setModel] = useState('default');
  const [thinkingLevel, setThinkingLevel] = useState('medium');
  const [responsibility, setResponsibility] = useState('按用户自定义职责参与 AT 群聊，由 manager 点名后回复。');
  const [commandTemplate, setCommandTemplate] = useState('cat "$AT_AGENT_PROMPT_FILE"');

  return (
    <article className="new-agent-form">
      <input value={roleId} onChange={(event) => setRoleId(event.target.value)} placeholder="role id，例如 qwen-architect" aria-label="new agent role id" />
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="显示名" aria-label="new agent name" />
      <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名" aria-label="new agent model" />
      <select value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value)} aria-label="new agent thinking level">
        {Object.entries(thinkingLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input value={responsibility} onChange={(event) => setResponsibility(event.target.value)} placeholder="职责" aria-label="new agent responsibility" />
      <input value={commandTemplate} onChange={(event) => setCommandTemplate(event.target.value)} placeholder="generic CLI command template" aria-label="new agent command template" />
      <button
        className="primary"
        type="button"
        disabled={!roleId.trim()}
        onClick={async () => {
          const created = await onCreate({
            roleId: roleId.trim(),
            name: name.trim() || roleId.trim(),
            cli: 'generic',
            adapter: 'generic-cli',
            command: 'zsh',
            commandTemplate,
            model,
            thinkingLevel,
            responsibility,
            defaultPermission: 'readonly'
          });
          if (created) {
            setRoleId('');
            setName('');
          }
        }}
      >
        新增 Agent
      </button>
    </article>
  );
}

function TeamDefaultsPanel({ onApply }) {
  const [model, setModel] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [defaultPermission, setDefaultPermission] = useState('');
  const [adapter, setAdapter] = useState('');
  const [command, setCommand] = useState('');
  const [commandTemplate, setCommandTemplate] = useState('');

  const config = {
    ...(model.trim() ? { model: model.trim() } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(defaultPermission ? { defaultPermission } : {}),
    ...(adapter.trim() ? { adapter: adapter.trim() } : {}),
    ...(command.trim() ? { command: command.trim() } : {}),
    ...(commandTemplate.trim() ? { commandTemplate } : {})
  };
  const canApply = Object.keys(config).length > 0;

  return (
    <article className="team-defaults-panel">
      <div className="team-defaults-head">
        <div>
          <strong>Team Defaults</strong>
          <span>批量应用到当前所有启用的 agent，只更新你填写的字段。</span>
        </div>
        <button className="primary compact-action" type="button" disabled={!canApply} onClick={() => onApply(config)}>
          应用到全队
        </button>
      </div>
      <div className="team-defaults-grid">
        <label>
          <span>模型</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 gpt-5.5 / deepseek-v4-pro" aria-label="team default model" />
        </label>
        <label>
          <span>Thinking</span>
          <select value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value)} aria-label="team default thinking level">
            <option value="">不改</option>
            {Object.entries(thinkingLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>默认权限</span>
          <select value={defaultPermission} onChange={(event) => setDefaultPermission(event.target.value)} aria-label="team default permission">
            <option value="">不改</option>
            {Object.entries(permissionLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Adapter</span>
          <input value={adapter} onChange={(event) => setAdapter(event.target.value)} placeholder="留空不改" aria-label="team default adapter" />
        </label>
        <label>
          <span>命令</span>
          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="留空不改" aria-label="team default command" />
        </label>
        <label className="wide-field">
          <span>command template</span>
          <textarea value={commandTemplate} onChange={(event) => setCommandTemplate(event.target.value)} placeholder="留空不改；generic-cli 才需要" aria-label="team default command template" />
        </label>
      </div>
    </article>
  );
}

function SecuritySettingsPanel({ platform }) {
  const security = platform?.security || {};
  const setup = platform?.setup || {};
  const maintenance = platform?.maintenance || {};
  return (
    <section className="settings-block security-panel">
      <div className="timeline-head">
        <strong>Security / Operations</strong>
        <span>本地信任边界和运维入口</span>
      </div>
      <div className="security-grid">
        <article>
          <span>API Token</span>
          <strong>{security.authEnabled ? 'enabled' : 'local open'}</strong>
          <p>{security.authEnabled ? '外部 agent 需要 token。' : '当前未启用 token；仅适合本机开发。'}</p>
        </article>
        <article>
          <span>CORS Origin</span>
          <strong>{security.corsOrigin || 'http://127.0.0.1:5173'}</strong>
          <p>团队环境保持明确 origin，不使用全开放 CORS。</p>
        </article>
        <article>
          <span>Agent Mode</span>
          <strong>{setup.agentMode || 'real'}</strong>
          <p>真实模式会调用本机 CLI；mock demo 只用于演示和测试。</p>
        </article>
        <article>
          <span>Data Path</span>
          <strong>{maintenance.dataPath || setup.dataPath || 'data/at-team.sqlite'}</strong>
          <p>SQLite transcript 默认明文保存，建议依赖本机磁盘加密。</p>
        </article>
      </div>
      <div className="permission-guide">
        {Object.entries(permissionLabels).map(([value, label]) => (
          <article key={value} className={value === 'danger' ? 'danger-permission' : ''}>
            <strong>{label}</strong>
            <span>{value === 'readonly' ? '默认审查' : value === 'write-proposed' ? '提出补丁/方案' : value === 'workspace-write' ? '允许写当前 workspace' : '高风险逐次确认'}</span>
          </article>
        ))}
      </div>
      <a className="export-link" href="/api/platform/export" download="at-platform-export.json">Export audit snapshot</a>
    </section>
  );
}

function SettingsView({ status, platform, onAgentConfigSave, onAgentCreate, onAgentDisable, onTeamConfigApply }) {
  return (
    <section className="view-page">
      <div className="view-header">
        <span>Settings</span>
        <strong>Customize AT Team</strong>
      </div>
      <SecuritySettingsPanel platform={platform} />
      <div className="settings-block">
        <div className="timeline-head">
          <strong>Agent / Model / Thinking 配置</strong>
          <span>统一设置职责、模型、思考强度、权限和 adapter</span>
        </div>
        <TeamDefaultsPanel onApply={onTeamConfigApply} />
        {status.agents.map((agent) => (
          <AgentConfigEditor key={agent.id} agent={agent} onSave={onAgentConfigSave} onDisable={onAgentDisable} />
        ))}
        <NewAgentForm onCreate={onAgentCreate} />
      </div>
      <div className="settings-list">
        <article>
          <strong>调度规则</strong>
          <p>Codex Manager 负责拆分和点名；reviewer 不自由互相触发；run 不会自动无限循环。</p>
        </article>
        <article>
          <strong>记忆隔离</strong>
          <p>按 project + role 保存 native session id。两个 Codex 岗位使用两条独立 session。</p>
        </article>
        <article>
          <strong>AT Manager Skill</strong>
          <code>/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md</code>
        </article>
        <article>
          <strong>Date / Time Skill</strong>
          <code>/Users/felix/.codex/skills/date-time-check/SKILL.md</code>
        </article>
        <article>
          <strong>Codex App Server</strong>
          <code>{status.codexCliServer?.command}</code>
        </article>
        <article>
          <strong>Generic CLI Env</strong>
          <p>generic-cli command template 可直接读取这些变量。</p>
          <div className="env-chip-list">
            {[
              'AT_AGENT_PROMPT_FILE',
              'AT_AGENT_PROMPT',
              'AT_AGENT_SESSION_ID',
              'AT_AGENT_PROJECT_PATH',
              'AT_AGENT_MODEL',
              'AT_AGENT_THINKING_LEVEL',
              'AT_AGENT_PERMISSION_PROFILE',
              'AT_AGENT_ROLE_ID',
              'AT_AGENT_NAME'
            ].map((name) => (
              <code key={name}>{name}</code>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function App() {
  const route = useHashRoute();
  const [status, setStatus] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [room, setRoom] = useState(null);
  const activeView = route.view;
  const activeWorkItemId = activeView === 'work' ? route.params.id : null;
  const [selectedRoleId, setSelectedRoleId] = useState(MANAGER_ROLE_ID);
  const [prompt, setPrompt] = useState(DEFAULT_CHAT_PROMPT);
  const [permission, setPermission] = useState('write-proposed');
  const [activeRunId, setActiveRunId] = useState(() => readStoredValue(storageKeys.activeRunId));
  const [connectionState, setConnectionState] = useState('idle');
  const [showSystemEvents, setShowSystemEventsState] = useState(() => readStoredValue(storageKeys.chatShowSystemEvents) === 'true');
  const [theme, setThemeState] = useState(() => {
    const stored = readStoredValue(storageKeys.theme);
    if (stored) return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [memory, setMemory] = useState(null);
  const [workActivity, setWorkActivity] = useState(null);
  const noticeTimerRef = useRef(null);
  const projectIdRef = useRef(null);

  const rememberActiveRun = useCallback((runId) => {
    setActiveRunId(runId || null);
    writeStoredValue(storageKeys.activeRunId, runId || null);
  }, []);

  const setShowSystemEvents = useCallback((value) => {
    setShowSystemEventsState(value);
    writeStoredValue(storageKeys.chatShowSystemEvents, value ? 'true' : null);
  }, []);

  const setTheme = useCallback((value) => {
    setThemeState(value);
    writeStoredValue(storageKeys.theme, value);
  }, []);

  function showNotice(message) {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 3200);
  }

  const refresh = useCallback(async (projectId = projectIdRef.current) => {
    const [data, platformData, roomData] = await Promise.all([
      api(projectId ? `/api/status?projectId=${projectId}` : '/api/status'),
      api(projectId ? `/api/platform?projectId=${projectId}` : '/api/platform'),
      api(projectId ? `/api/chat?projectId=${projectId}` : '/api/chat')
    ]);
    projectIdRef.current = data.project?.id || projectId || null;
    setStatus(data);
    setPlatform(platformData);
    setRoom(roomData);
    return data;
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const changeView = useCallback((view) => route.navigate(view), [route]);

  const selectedAgent = useMemo(
    () => status?.agents?.find((agent) => agent.id === selectedRoleId) || status?.agents?.[0],
    [status, selectedRoleId]
  );
  const selectedSessionUpdated = selectedAgent?.session?.updated_at;

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  useEffect(() => {
    if (!activeRunId) {
      setConnectionState('idle');
      return undefined;
    }
    let source = null;
    let reconnectDelay = 1000;
    let reconnectTimer = null;
    let isCancelled = false;

    const sync = () => refresh().catch((err) => setError(err.message));

    function connect() {
      if (isCancelled) return;
      setConnectionState('connecting');
      source = new EventSource(eventStreamUrl(`/api/runs/${activeRunId}/events`));
      source.onopen = () => {
        reconnectDelay = 1000;
        setConnectionState('live');
      };
      source.onerror = () => {
        if (isCancelled) return;
        setConnectionState('reconnecting');
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          reconnectTimer = window.setTimeout(connect, Math.min(reconnectDelay, 30000));
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        }
      };
      for (const eventName of [
        'run.created',
        'agent.queued',
        'agent.started',
        'agent.permission.requested',
        'agent.approval.requested',
        'permission.updated',
        'agent.completed',
        'agent.failed'
      ]) {
        source.addEventListener(eventName, sync);
      }
    }

    connect();
    return () => {
      isCancelled = true;
      window.clearTimeout(reconnectTimer);
      if (source) source.close();
    };
  }, [activeRunId, refresh]);

  useEffect(() => {
    const projectId = status?.project?.id;
    if (!projectId || !selectedRoleId) return;
    api(`/api/agents/${selectedRoleId}/memory?projectId=${projectId}`)
      .then(setMemory)
      .catch(() => setMemory(null));
  }, [status?.project?.id, selectedRoleId, selectedSessionUpdated]);

  useEffect(() => {
    const projectId = status?.project?.id;
    if (!projectId || !activeWorkItemId) {
      setWorkActivity(null);
      return;
    }
    api(`/api/work-items/${activeWorkItemId}/activity?projectId=${projectId}`)
      .then(setWorkActivity)
      .catch(() => setWorkActivity(null));
  }, [status?.project?.id, activeWorkItemId, room?.workItems?.length]);

  async function runTask() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const endpoint = activeView === 'chat' ? '/api/chat/messages' : '/api/runs';
      const payload = activeView === 'chat'
        ? {
            projectId: status?.project?.id,
            title: prompt.slice(0, 48),
            content: prompt,
            permissionProfile: permission
          }
        : {
            projectId: status?.project?.id,
            title: prompt.slice(0, 48),
            prompt,
            permissionProfile: permission
          };
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      rememberActiveRun(result.run.id);
      await refresh(result.run.project_id);
      showNotice(activeView === 'chat' ? '已发送到 AT 群聊，Manager 正在处理。' : '已创建 manager run。');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runStarterTask(content) {
    setPrompt(content);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          projectId: status?.project?.id,
          title: content.slice(0, 48),
          content,
          permissionProfile: permission
        })
      });
      rememberActiveRun(result.run.id);
      await refresh(result.run.project_id);
      showNotice('Starter task 已发送到 AT 群聊。');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }


  async function updatePermission(roleId, permissionProfile) {
    setError('');
    try {
      await api(`/api/agents/${roleId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ projectId: status.project.id, permissionProfile })
      });
      showNotice(`${roleId} 权限已更新为 ${permissionLabels[permissionProfile] || permissionProfile}。`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAgentConfig(roleId, config) {
    setError('');
    try {
      await api(`/api/agents/${roleId}/config`, {
        method: 'POST',
        body: JSON.stringify(config)
      });
      showNotice(`${roleId} 配置已保存。`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateTeamConfig(config) {
    setError('');
    try {
      await api('/api/team/config', {
        method: 'POST',
        body: JSON.stringify({ config })
      });
      showNotice('Team Defaults 已应用到启用的 agent。');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createAgent(config) {
    setError('');
    try {
      await api('/api/agents', {
        method: 'POST',
        body: JSON.stringify(config)
      });
      showNotice(`${config.roleId} 已加入 AT。`);
      await refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function disableAgent(roleId) {
    setError('');
    try {
      await api(`/api/agents/${roleId}`, { method: 'DELETE' });
      showNotice(`${roleId} 已禁用，记忆仍保留。`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createWorkItem(config) {
    setError('');
    try {
      const result = await api('/api/work-items', {
        method: 'POST',
        body: JSON.stringify({
          projectId: status?.project?.id,
          ...config
        })
      });
      if (result.workItem?.linkedRunId) rememberActiveRun(result.workItem.linkedRunId);
      showNotice(`${workTypeLabels[result.workItem.type] || result.workItem.type} 已创建。`);
      await refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function updateWorkItem(id, updates) {
    setError('');
    try {
      await api(`/api/work-items/${id}`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: status?.project?.id,
          ...updates
        })
      });
      showNotice(`Work item ${id.slice(0, 8)} 已更新。`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openWorkItemWithManager(item) {
    setBusy(true);
    setError('');
    try {
      const result = await api(`/api/work-items/${item.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: status?.project?.id,
          permissionProfile: permission
        })
      });
      rememberActiveRun(result.run.id);
      showNotice(`Work item ${item.id.slice(0, 8)} 已交给 Manager。`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createReviewRequest(item) {
    const title = `Review: ${item.title}`;
    const created = await createWorkItem({
      type: 'review',
      title,
      body: [
        `Parent work item #${item.id.slice(0, 8)} (${item.type})`,
        item.body || '',
        '',
        '请 reviewer 基于当前 team transcript 给出风险、阻塞点和可执行建议。'
      ].join('\n'),
      priority: item.priority || 'medium',
      assignedRoleId: item.assignedRoleId || 'claude-deep-review',
      parentId: item.id,
      dispatchToManager: true
    });
    if (created) showNotice(`已为 ${item.id.slice(0, 8)} 创建 review request。`);
    return created;
  }

  async function dispatchRole(roleId) {
    if (!activeRunId) return;
    setBusy(true);
    try {
      await api(`/api/runs/${activeRunId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          roleId,
          task: `请基于当前 team transcript，从你的岗位审查 manager 的任务结果。`,
          permissionProfile: status.agents.find((agent) => agent.id === roleId)?.session?.permission_profile || 'readonly'
        })
      });
      await refresh();
      showNotice(`Manager 已点名 ${roleId}。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return <div className="loading">正在启动 AT Agent Team runtime...</div>;
  }

  return (
    <div className="app-shell">
      <Sidebar project={status.project} activeView={activeView} onViewChange={changeView} />
      <main>
        <div className="utility-bar" aria-label="workspace state">
          <span>当前 run: {activeRunId ? activeRunId.slice(0, 8) : '未开始'}</span>
          <span>连接: {connectionState === 'live' ? '实时' : connectionState === 'reconnecting' ? '重连中' : connectionState === 'connecting' ? '连接中' : '空闲'}</span>
          <button className="ghost compact theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </div>
        {error ? <div className="error" role="alert">{error}</div> : null}
        {notice ? <div className="notice" role="status" aria-live="polite">{notice}</div> : null}
        {activeView === 'platform' ? <PlatformView status={status} platform={platform} /> : null}
        {activeView === 'chat' ? (
          <ChatView
            status={status}
            room={room}
            prompt={prompt}
            setPrompt={setPrompt}
            permission={permission}
            setPermission={setPermission}
            runTask={runTask}
            runStarterTask={runStarterTask}
            busy={busy}
            activeRunId={activeRunId}
            connectionState={connectionState}
            showSystemEvents={showSystemEvents}
            setShowSystemEvents={setShowSystemEvents}
            selectedRoleId={selectedRoleId}
            setSelectedRoleId={setSelectedRoleId}
            dispatchRole={dispatchRole}
          />
        ) : null}
        {activeView === 'team' ? (
          <TeamView
            status={status}
            activeRunId={activeRunId}
            selectedAgent={selectedAgent}
            selectedRoleId={selectedRoleId}
            setSelectedRoleId={setSelectedRoleId}
            updatePermission={updatePermission}
            dispatchRole={dispatchRole}
            memory={memory}
          />
        ) : null}
        {activeView === 'work' ? (
          <WorkBoardView
            status={status}
            room={room}
            activeWorkItemId={activeWorkItemId}
            workActivity={workActivity}
            onCreateWorkItem={createWorkItem}
            onUpdateWorkItem={updateWorkItem}
            onOpenWorkItemWithManager={openWorkItemWithManager}
            onCreateReviewRequest={createReviewRequest}
            onOpenWorkItemDetail={(id) => route.navigate('work', id)}
            onCloseWorkItemDetail={() => route.navigate('work')}
          />
        ) : null}
        {activeView === 'project' ? <ProjectView status={status} /> : null}
        {activeView === 'sessions' ? (
          <SessionsView
            status={status}
            selectedRoleId={selectedRoleId}
            setSelectedRoleId={setSelectedRoleId}
            updatePermission={updatePermission}
          />
        ) : null}
        {activeView === 'api' ? <ApiView status={status} activeRunId={activeRunId} /> : null}
        {activeView === 'settings' ? (
          <SettingsView
            status={status}
            platform={platform}
            onAgentConfigSave={updateAgentConfig}
            onAgentCreate={createAgent}
            onAgentDisable={disableAgent}
            onTeamConfigApply={updateTeamConfig}
          />
        ) : null}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
