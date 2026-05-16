import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

let server = null;

function pass(name, detail = '') {
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
}

function fail(name, error) {
  console.error(`FAIL ${name} - ${error.message}`);
  process.exitCode = 1;
}

async function waitFor(url, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureServer() {
  try {
    return await waitFor('http://127.0.0.1:5174/api/status', 1000);
  } catch {
    server = spawn('node', ['server/http.js'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_AGENT_MODE: 'mock' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', (chunk) => process.stdout.write(chunk));
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    return waitFor('http://127.0.0.1:5174/api/status', 12000);
  }
}

try {
  execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe' });
  pass('build', 'dist is current');

  const source = readFileSync('src/main.jsx', 'utf8');
  for (const requiredText of [
    'AT 群聊',
    'AT AI 合作群聊',
    'POST /api/chat/messages',
    'POST /api/work-items',
    'GET /api/chat',
    'team_chat_message',
    'team_get_room',
    'team_create_work_item',
    'team_get_work_items',
    "['work', 'Work', GitPullRequest]",
    'AT 协作对象板',
    '创建 Work Item',
    "['platform', 'Platform', ShieldCheck]",
    '本地 Agent Runtime 控制平面',
    'Adapter Registry',
    'npm run smoke:manager',
    'npm run verify',
    'npm run verify:complete',
    'npm run audit',
    'npm run audit:complete',
    "['chat', 'Chat', MessageSquare]",
    '入口 1',
    '上方聊天框',
    '入口 2',
    '外部 agent 调 API 当 manager',
    'Codex App Server',
    'Customize AT Team',
    'Agent / Model / Thinking 配置',
    'Team Defaults',
    '应用到全队',
    'Thinking',
    'command template',
    '新增 Agent',
    '禁用',
    'Date / Time Skill',
    '/Users/felix/.codex/skills/date-time-check/SKILL.md',
    '自由讨论 / 无限循环: 关'
  ]) {
    if (!source.includes(requiredText)) throw new Error(`Missing UI label: ${requiredText}`);
  }
  pass('ui labels', 'group chat, two interaction modes, and loop guards are present');

  await ensureServer();
  const status = await (await fetch('http://127.0.0.1:5174/api/status')).json();
  if (!Array.isArray(status.agents) || status.agents.length !== 4) {
    throw new Error('Expected 4 agents from /api/status');
  }
  const manager = status.agents.find((agent) => agent.id === 'codex-manager');
  const goal = status.agents.find((agent) => agent.id === 'codex-goal-review');
  if (!manager || !goal || manager.session.native_session_id === goal.session.native_session_id) {
    throw new Error('Codex manager and goal reviewer sessions are not split');
  }
  if (status.codexCliServer?.kind !== 'codex app-server') {
    throw new Error(`Expected codex app-server status, got ${status.codexCliServer?.kind}`);
  }
  pass('api status', '4 agents, split Codex sessions, and app-server status');

  const html = await (await fetch('http://127.0.0.1:5174/')).text();
  if (!html.includes('AT Agent Team') || !html.includes('/assets/')) {
    throw new Error('Served HTML does not look like the built app');
  }
  pass('served ui', 'http://127.0.0.1:5174/');
} catch (error) {
  fail('ui smoke', error);
} finally {
  if (server) server.kill('SIGTERM');
}
