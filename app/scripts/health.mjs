import { execFileSync, spawn } from 'node:child_process';
import { ensureCodexCliServer, getCodexCliServerStatus } from '../server/codexCliServer.js';

const checks = [];
let server = null;
let codexServer = null;

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ''}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    ...options
  }).trim();
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

async function ensureApi() {
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
  record('node', true, run('node', ['--version']));
  record('npm', true, run('npm', ['--version']));
  record('codex cli', true, run('codex', ['--version']));
  record('claude code', true, run('claude', ['--version']));
  record('kimi cli', true, run('kimi', ['--version']));

  const codexServerResult = await ensureCodexCliServer({ stdio: 'pipe' });
  codexServer = codexServerResult.child;
  const codexServerStatus = await getCodexCliServerStatus();
  record('codex app-server', codexServerStatus.connected && codexServerStatus.kind === 'codex app-server', codexServerStatus.url);

  const testOutput = run('npm', ['test']);
  record('runtime tests', /fail 0/.test(testOutput) && /pass [1-9]\d*/.test(testOutput), 'node --test');

  run('npm', ['run', 'build']);
  record('production build', true, 'dist generated');

  const preflightOutput = run('npm', ['run', 'preflight']);
  const preflightJson = preflightOutput.slice(preflightOutput.indexOf('{'));
  const preflight = JSON.parse(preflightJson);
  record('codex session split', preflight.codexSessionsAreSplit === true, 'manager and goal reviewer are separate');

  const apiResponse = await ensureApi();
  const status = await apiResponse.json();
  record('api status', Array.isArray(status.agents) && status.agents.length === 4, '4 agents available');
  record('api codex transport', status.codexCliServer?.kind === 'codex app-server', status.codexCliServer?.command || '');

  const auditOutput = run('npm', ['run', 'audit']);
  const auditJson = auditOutput.slice(auditOutput.indexOf('{'));
  const audit = JSON.parse(auditJson);
  record('completion audit', audit.checks?.every((check) => check.ok) === true, `cutoff reached: ${audit.cutoffReached}`);

  const pageResponse = await waitFor('http://127.0.0.1:5174/');
  const html = await pageResponse.text();
  record('served UI', html.includes('AT Agent Team'), 'http://127.0.0.1:5174/');
} catch (error) {
  record('health command', false, error.message);
} finally {
  if (server) server.kill('SIGTERM');
  if (codexServer) codexServer.kill('SIGTERM');
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} health check(s) failed.`);
  process.exit(1);
}

console.log('\nAll health checks passed.');
