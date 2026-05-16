import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || response.statusText);
  return json;
}

async function postJsonWithHeaders(baseUrl, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  return { response, json };
}

function collectSseEvents(url, wantedTypes) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = request(url, (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!eventLine || !dataLine) continue;
          const type = eventLine.slice('event: '.length);
          const data = JSON.parse(dataLine.slice('data: '.length));
          events.push({ type, data });
          if (wantedTypes.every((wanted) => events.some((event) => event.type === wanted))) {
            req.destroy();
            resolve(events);
          }
        }
      });
    });
    req.on('error', (error) => {
      if (events.length && error.code === 'ECONNRESET') return;
      reject(error);
    });
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`Timed out waiting for SSE events: ${wantedTypes.join(', ')}`));
    });
    req.end();
  });
}

test('HTTP SSE exposes approval request events from the shared runtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-team-http-'));
  const port = 6174 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AT_TEAM_DB_PATH: join(dir, 'http.sqlite'),
      AT_TEAM_AGENT_MODE: 'mock',
      PORT: String(port),
      AT_TEAM_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForServer(baseUrl);
    const platform = await (await fetch(`${baseUrl}/api/platform`)).json();
    assert.ok(platform.adapters.some((adapter) => adapter.id === 'generic-cli'));
    assert.ok(platform.checks.some((check) => check.id === 'codex-app-server'));
    const traversal = await fetch(`${baseUrl}/../../package.json`);
    const traversalText = await traversal.text();
    assert.equal(traversal.status, 200);
    assert.ok(!traversalText.includes('"scripts"'));
    assert.ok(traversalText.includes('AT Agent Team'));
    const room = await (await fetch(`${baseUrl}/api/chat`)).json();
    assert.equal(room.room.name, 'AT AI 合作群聊');
    assert.ok(room.participants.some((participant) => participant.id === 'codex-manager'));
    assert.ok(Array.isArray(room.workItems));

    const workCreated = await postJson(baseUrl, '/api/work-items', {
      type: 'issue',
      title: 'HTTP work item test',
      body: 'Track collaboration outside chat.',
      priority: 'high',
      assignedRoleId: 'codex-manager'
    });
    assert.equal(workCreated.workItem.type, 'issue');
    assert.equal(workCreated.workItem.status, 'open');
    const workUpdated = await postJson(baseUrl, `/api/work-items/${workCreated.workItem.id}`, {
      status: 'review',
      assignedRoleId: 'kimi-ux-review'
    });
    assert.equal(workUpdated.workItem.status, 'review');
    assert.equal(workUpdated.workItem.assignedRoleId, 'kimi-ux-review');
    const workList = await (await fetch(`${baseUrl}/api/work-items`)).json();
    assert.ok(workList.workItems.some((item) => item.id === workCreated.workItem.id));
    const workDispatched = await postJson(baseUrl, `/api/work-items/${workCreated.workItem.id}/dispatch`, {
      permissionProfile: 'readonly'
    });
    assert.equal(workDispatched.item.linkedRunId, workDispatched.run.id);
    assert.equal(workDispatched.item.status, 'in-progress');
    const workActivity = await (await fetch(`${baseUrl}/api/work-items/${workCreated.workItem.id}/activity`)).json();
    assert.equal(workActivity.item.id, workCreated.workItem.id);
    assert.ok(workActivity.runs.some((run) => run.id === workDispatched.run.id));
    assert.ok(workActivity.events.some((event) => event.type === 'work.item.dispatched'));
    const platformAfterWork = await (await fetch(`${baseUrl}/api/platform`)).json();
    assert.equal(platformAfterWork.setup.authEnabled, false);
    assert.equal(platformAfterWork.setup.agentMode, 'mock');
    assert.equal(platformAfterWork.security.corsOrigin, 'http://127.0.0.1:5173');
    assert.ok(platformAfterWork.maintenance.cleanupPreviewOnly);

    const invalidAgent = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleId: 'Bad Role', adapter: 'generic-cli' })
    });
    const invalidAgentBody = await invalidAgent.json();
    assert.equal(invalidAgent.status, 400);
    assert.match(invalidAgentBody.error, /roleId must be/);
    assert.equal(invalidAgentBody.stack, undefined);

    await postJson(baseUrl, '/api/agents', {
      roleId: 'approval-sse-agent',
      adapter: 'event-test',
      cli: 'generic',
      command: 'zsh',
      commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
      model: 'local'
    });
    const created = await postJson(baseUrl, '/api/runs', { prompt: 'sse approval test', permissionProfile: 'readonly' });
    const sse = collectSseEvents(`${baseUrl}/api/runs/${created.run.id}/events`, [
      'agent.approval.requested',
      'agent.completed'
    ]);
    await postJson(baseUrl, `/api/runs/${created.run.id}/dispatch`, {
      roleId: 'approval-sse-agent',
      task: 'trigger approval event',
      permissionProfile: 'write-proposed'
    });
    const events = await sse;
    const approval = events.find((event) => event.type === 'agent.approval.requested');
    assert.equal(JSON.parse(approval.data.payload).autoResponse, 'decline');

    const exportResponse = await fetch(`${baseUrl}/api/platform/export`);
    assert.equal(exportResponse.headers.get('content-disposition'), 'attachment; filename="at-platform-export.json"');
    const exported = await exportResponse.json();
    assert.equal(exported.format, 'at-agent-team-platform-export/v1');
    assert.ok(exported.sessions.some((session) => session.role_id === 'approval-sse-agent'));
    assert.ok(exported.workItems.some((item) => item.id === workCreated.workItem.id));

    const chatPosted = await postJson(baseUrl, '/api/chat/messages', {
      content: 'HTTP AT 群聊入口测试',
      permissionProfile: 'readonly'
    });
    assert.equal(chatPosted.accepted, true);
    assert.match(chatPosted.eventStream, /\/api\/runs\/.+\/events/);
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP API supports optional token auth, body limits, and sanitized server errors', { timeout: 70000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-team-http-auth-'));
  const port = 20000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AT_TEAM_DB_PATH: join(dir, 'http.sqlite'),
      AT_TEAM_AGENT_MODE: 'mock',
      PORT: String(port),
      AT_TEAM_PORT: String(port),
      AT_TEAM_API_TOKEN: 'test-token',
      AT_TEAM_MAX_BODY_BYTES: '96'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    let ready = false;
    for (let i = 0; i < 600; i += 1) {
      const response = await fetch(`${baseUrl}/api/status`).catch(() => null);
      if (response?.status === 401) {
        ready = true;
        break;
      }
      await wait(100);
    }
    if (!ready) throw new Error(`Timed out waiting for auth test server at ${baseUrl}\n${serverOutput}`);
    const unauthorized = await fetch(`${baseUrl}/api/status`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error, 'Unauthorized');

    const authorized = await fetch(`${baseUrl}/api/status`, { headers: { 'x-at-token': 'test-token' } });
    assert.equal(authorized.status, 200);
    const bearerAuthorized = await fetch(`${baseUrl}/api/status`, { headers: { authorization: 'Bearer test-token' } });
    assert.equal(bearerAuthorized.status, 200);
    const queryAuthorized = await fetch(`${baseUrl}/api/status?token=test-token`);
    assert.equal(queryAuthorized.status, 200);

    const tooLarge = await postJsonWithHeaders(baseUrl, '/api/work-items', {
      title: 'x'.repeat(200)
    }, { 'x-at-token': 'test-token' });
    assert.equal(tooLarge.response.status, 400);
    assert.equal(tooLarge.json.error, 'Request body too large');
    assert.equal(tooLarge.json.stack, undefined);

    const serverError = await postJsonWithHeaders(baseUrl, '/api/runs', {
      prompt: 'x'
    }, { 'x-at-token': 'test-token' });
    assert.ok([202, 400, 500].includes(serverError.response.status));
    assert.equal(serverError.json.stack, undefined);

    const html = await fetch(`${baseUrl}/`, { headers: { 'x-at-token': 'test-token' } });
    assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});
