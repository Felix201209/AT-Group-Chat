const API = process.env.AT_TEAM_API || 'http://127.0.0.1:5174';
const expected = process.env.AT_MANAGER_SMOKE_EXPECTED || 'AT manager smoke OK';
const content = `AT manager smoke: 请只回复 ${expected}，不要改文件，不要调度其他 agent。`;

async function getJson(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const json = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

const started = await getJson('/api/chat/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    content,
    permissionProfile: 'readonly'
  })
});

const runId = started.run?.id;
if (!runId) throw new Error('manager smoke did not return a run id');

const deadline = Date.now() + Number(process.env.AT_MANAGER_SMOKE_TIMEOUT_MS || 90000);
let lastEvents = [];

while (Date.now() < deadline) {
  const status = await getJson('/api/status');
  lastEvents = (status.events || []).filter((event) => event.run_id === runId);
  const terminal = lastEvents.find((event) => event.type === 'agent.completed' || event.type === 'agent.failed');
  if (terminal) {
    const payload = JSON.parse(terminal.payload || '{}');
    const ok =
      terminal.type === 'agent.completed' &&
      payload.roleId === 'codex-manager' &&
      payload.output?.trim() === expected &&
      payload.command?.startsWith('codex app-server') &&
      payload.noAutoFollowup === true;
    console.log(JSON.stringify({
      ok,
      runId,
      expected,
      terminal: {
        type: terminal.type,
        roleId: terminal.role_id,
        output: payload.output,
        command: payload.command,
        noAutoFollowup: payload.noAutoFollowup
      }
    }, null, 2));
    process.exit(ok ? 0 : 1);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

console.log(JSON.stringify({ ok: false, runId, expected, lastEvents }, null, 2));
throw new Error(`timed out waiting for manager smoke run ${runId}`);
