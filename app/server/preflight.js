import { execFileSync } from 'node:child_process';
import { runtime } from './singleton.js';
import { ensureCodexCliServer } from './codexCliServer.js';

function version(command, args = ['--version']) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
  } catch (error) {
    return `ERROR: ${error.message}`;
  }
}

async function readReadyStatus() {
  let latest = null;
  for (let i = 0; i < 24; i += 1) {
    latest = await runtime.teamStatus();
    if (latest.codexCliServer?.connected) return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return latest || await runtime.teamStatus();
}

let codexServer = null;

try {
  const ensured = await ensureCodexCliServer({ stdio: 'pipe' });
  codexServer = ensured.child;

  const status = await readReadyStatus();
  const manager = status.agents.find((agent) => agent.id === 'codex-manager')?.session;
  const goal = status.agents.find((agent) => agent.id === 'codex-goal-review')?.session;
  const codexSessionsAreSplit = Boolean(manager && goal && manager.native_session_id !== goal.native_session_id);

  const report = {
    cli: {
      codex: version('codex'),
      claude: version('claude'),
      kimi: version('kimi')
    },
    project: status.project,
    codexCliServer: status.codexCliServer,
    codexSessionsAreSplit,
    sessions: status.agents.map((agent) => ({
      roleId: agent.id,
      cli: agent.cli,
      adapter: agent.adapter,
      model: agent.model,
      nativeSessionId: agent.session.native_session_id,
      permissionProfile: agent.session.permission_profile
    }))
  };

  const failures = [];
  for (const [name, output] of Object.entries(report.cli)) {
    if (!output || output.startsWith('ERROR:')) failures.push(`${name} CLI unavailable`);
  }
  if (status.codexCliServer?.kind !== 'codex app-server') failures.push('Codex transport is not app-server');
  if (!status.codexCliServer?.connected) failures.push('Codex app-server is not connected');
  if (!codexSessionsAreSplit) failures.push('codex-manager and codex-goal-review sessions are not split');
  for (const roleId of ['codex-manager', 'claude-deep-review', 'kimi-ux-review', 'codex-goal-review']) {
    if (!status.agents.some((agent) => agent.id === roleId)) failures.push(`missing role ${roleId}`);
  }

  report.ok = failures.length === 0;
  report.failures = failures;

  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) {
    console.error(`Preflight failed: ${failures.join('; ')}`);
    process.exit(1);
  }
} finally {
  if (codexServer) codexServer.kill('SIGTERM');
}
