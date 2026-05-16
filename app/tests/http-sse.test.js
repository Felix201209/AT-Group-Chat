import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTestPublicDir(dir) {
  const publicDir = join(dir, 'dist');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>AT Agent Team test shell</title>');
  return publicDir;
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

async function waitForServerWithHeaders(baseUrl, headers = {}) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/status`, { headers });
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
      if (events.length && error.code === 'ECONNRESET') {
        reject(new Error(`SSE connection reset before receiving all wanted events: ${wantedTypes.join(', ')}`));
        return;
      }
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
  const publicDir = createTestPublicDir(dir);
  const port = 6174 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AT_TEAM_DB_PATH: join(dir, 'http.sqlite'),
      AT_TEAM_PUBLIC_DIR: publicDir,
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
    await waitForServerWithHeaders(baseUrl, { 'x-at-token': 'admin-token' });
    const platform = await (await fetch(`${baseUrl}/api/platform`)).json();
    assert.ok(platform.adapters.some((adapter) => adapter.id === 'generic-cli'));
    assert.ok(platform.checks.some((check) => check.id === 'codex-app-server'));
    const openapi = await (await fetch(`${baseUrl}/api/openapi.json`)).json();
    assert.equal(openapi.openapi, '3.1.0');
    assert.equal(openapi.info.title, 'AT Group Chat Local API');
    assert.ok(openapi.paths['/api/contract']);
    assert.equal(
      openapi.paths['/api/contract'].get.responses[200].content['application/json'].schema.properties.mode.enum[0],
      'manager-controlled'
    );
    assert.ok(openapi.paths['/api/chat/messages']);
    assert.ok(openapi.paths['/api/work-items']);
    assert.ok(openapi.paths['/api/work-items/{id}']);
    assert.ok(openapi.paths['/api/agents/{roleId}/permissions']);
    assert.ok(openapi.paths['/api/agents/{roleId}/memory']);
    assert.ok(openapi.paths['/api/agents/{roleId}/message']);
    assert.ok(openapi.paths['/api/team/config']);
    const traversal = await fetch(`${baseUrl}/../../package.json`);
    const traversalText = await traversal.text();
    assert.equal(traversal.status, 200);
    assert.ok(!traversalText.includes('"scripts"'));
    assert.ok(traversalText.includes('AT Agent Team'));
    const room = await (await fetch(`${baseUrl}/api/chat`)).json();
    assert.equal(room.room.name, 'AT AI 合作群聊');
    assert.ok(room.participants.some((participant) => participant.id === 'codex-manager'));
    assert.ok(Array.isArray(room.workItems));
    const contract = await (await fetch(`${baseUrl}/api/contract`)).json();
    assert.equal(contract.mode, 'manager-controlled');
    assert.equal(contract.http.getContract, 'GET /api/contract');
    assert.equal(contract.http.createTask, 'POST /api/runs');
    assert.equal(contract.http.postChatMessage, 'POST /api/chat/messages');
    assert.ok(contract.mcpTools.includes('team_get_manager_contract'));
    assert.ok(contract.rules.some((rule) => rule.includes('Do not create autonomous discussion loops')));

    const workCreated = await postJson(baseUrl, '/api/work-items', {
      type: 'issue',
      title: 'HTTP work item test',
      body: 'Track collaboration outside chat.',
      priority: 'high',
      assignedRoleId: 'codex-manager'
    });
    assert.equal(workCreated.workItem.type, 'issue');
    assert.equal(workCreated.workItem.status, 'open');
    const hookCreated = await postJson(baseUrl, '/api/hooks/events', {
      source: 'github-actions',
      event: 'test.failed',
      type: 'issue',
      title: 'CI failed through hook',
      body: 'Webhook-style event ingestion.',
      priority: 'urgent',
      metadata: { runUrl: 'https://example.invalid/run/1' }
    });
    assert.equal(hookCreated.type, 'issue');
    assert.equal(hookCreated.priority, 'urgent');
    assert.equal(hookCreated.metadata.source, 'github-actions');
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

    const manifestApplied = await postJson(baseUrl, '/api/team/manifest', {
      manifest: {
        name: 'HTTP manifest smoke',
        workItems: [{
          type: 'artifact',
          title: 'HTTP manifest artifact',
          body: 'Seeded by manifest endpoint.'
        }]
      }
    });
    assert.equal(manifestApplied.manifest.name, 'HTTP manifest smoke');
    assert.ok(manifestApplied.applied.workItems.some((item) => item.type === 'artifact'));
    const manifestAppliedAgain = await postJson(baseUrl, '/api/team/manifest', {
      manifest: {
        name: 'HTTP manifest smoke',
        workItems: [{
          type: 'artifact',
          title: 'HTTP manifest artifact',
          body: 'Updated by repeated manifest apply.'
        }]
      }
    });
    assert.equal(manifestAppliedAgain.applied.workItems[0].manifestExisting, true);

    const invalidManifest = await fetch(`${baseUrl}/api/team/manifest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { defaults: { roleIds: ['codex-manager'], responsibility: 'invalid here' } } })
    });
    const invalidManifestBody = await invalidManifest.json();
    assert.equal(invalidManifest.status, 400);
    assert.match(invalidManifestBody.error, /manifest\.defaults has unknown field/);

    const dangerousManifest = await fetch(`${baseUrl}/api/team/manifest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          agents: [{
            roleId: 'dangerous-manifest-agent',
            adapter: 'generic-cli',
            command: 'zsh',
            commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"; rm -rf /tmp/not-real',
            model: 'local'
          }]
        }
      })
    });
    const dangerousManifestBody = await dangerousManifest.json();
    assert.equal(dangerousManifest.status, 400);
    assert.match(dangerousManifestBody.error, /dangerousCommandTemplate/);

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
  const publicDir = createTestPublicDir(dir);
  const port = 20000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AT_TEAM_DB_PATH: join(dir, 'http.sqlite'),
      AT_TEAM_PUBLIC_DIR: publicDir,
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

test('HTTP hook endpoint can use a separate hook token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-team-http-hook-token-'));
  const port = 30000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AT_TEAM_DB_PATH: join(dir, 'hook-token.sqlite'),
      AT_TEAM_AGENT_MODE: 'mock',
      PORT: String(port),
      AT_TEAM_PORT: String(port),
      AT_TEAM_API_TOKEN: 'admin-token',
      AT_TEAM_HOOK_TOKEN: 'hook-token'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServerWithHeaders(baseUrl, { 'x-at-token': 'admin-token' });
    const rejected = await postJsonWithHeaders(baseUrl, '/api/hooks/events', {
      title: 'Unauthorized hook'
    }, { 'x-at-token': 'admin-token' });
    assert.equal(rejected.response.status, 401);

    const accepted = await postJsonWithHeaders(baseUrl, '/api/hooks/events', {
      title: 'Authorized hook',
      metadata: { deliveryId: 'delivery-1' }
    }, { 'x-at-hook-token': 'hook-token' });
    assert.equal(accepted.response.status, 202);
    assert.equal(accepted.json.metadata.deliveryId, 'delivery-1');
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});
