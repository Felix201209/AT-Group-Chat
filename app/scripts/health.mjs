import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCodexCliServer, getCodexCliServerStatus } from '../server/codexCliServer.js';
import { openApiSpec } from '../server/openapi.js';

const checks = [];
let server = null;
let codexServer = null;
const jsonMode = process.argv.includes('--json');
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceMode = existsSync(resolve(appRoot, 'tests/runtime.test.js')) &&
  existsSync(resolve(appRoot, 'scripts/completion-audit.mjs'));
const apiPort = Number(process.env.PORT || process.env.AT_TEAM_PORT || 5174);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (jsonMode) return;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ''}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    ...options
  }).trim();
}

function commandCheck(name, command, args = ['--version'], { required = true } = {}) {
  try {
    record(name, true, run(command, args));
    return true;
  } catch (error) {
    record(name, !required, required ? error.message : `optional: ${error.message}`);
    return false;
  }
}

function nodeSatisfiesEngine(version, range = '>=20') {
  const major = Number.parseInt(String(version || '').replace(/^v/, '').split('.')[0], 10);
  const requiredMajor = Number.parseInt(String(range).match(/>=\s*(\d+)/)?.[1] || '0', 10);
  return Number.isFinite(major) && major >= requiredMajor;
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Keep scanning; earlier logs may contain braces.
    }
  }
  throw new Error('Command did not print a JSON object');
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
    return await waitFor(`${apiBaseUrl}/api/status`, 1000);
  } catch {
    server = spawn('node', ['server/http.js'], {
      cwd: appRoot,
      env: { ...process.env, AT_TEAM_AGENT_MODE: 'mock' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (!jsonMode) {
      server.stdout.on('data', (chunk) => process.stdout.write(chunk));
      server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    }
    return waitFor(`${apiBaseUrl}/api/status`, 12000);
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

try {
  const pkg = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8'));
  record('package version', pkg.version === openApiSpec.info.version, `${pkg.name}@${pkg.version}`);
  record('runtime mode', true, sourceMode ? 'source checkout' : 'installed package');
  record('node engine', nodeSatisfiesEngine(process.version, pkg.engines?.node), `${process.version} satisfies ${pkg.engines?.node || 'unspecified'}`);
  commandCheck('node', 'node');
  commandCheck('npm', 'npm');
  const hasCodex = commandCheck('codex cli', 'codex', ['--version'], { required: sourceMode });
  commandCheck('claude code', 'claude', ['--version'], { required: sourceMode });
  commandCheck('kimi cli', 'kimi', ['--version'], { required: sourceMode });

  if (hasCodex) {
    const codexServerResult = await ensureCodexCliServer({ stdio: 'pipe' });
    codexServer = codexServerResult.child;
    const codexServerStatus = await getCodexCliServerStatus();
    record('codex app-server', codexServerStatus.connected && codexServerStatus.kind === 'codex app-server', codexServerStatus.url);
  } else {
    record('codex app-server', !sourceMode, 'optional until real Codex roles are used');
  }

  if (sourceMode) {
    const testOutput = run('npm', ['test']);
    record('runtime tests', /fail 0/.test(testOutput) && /pass [1-9]\d*/.test(testOutput), 'node --test');

    run('npm', ['run', 'build']);
    record('production build', true, 'dist generated');

    const preflightOutput = run('npm', ['run', 'preflight']);
    const preflight = parseJsonOutput(preflightOutput);
    record('codex session split', preflight.codexSessionsAreSplit === true, 'manager and goal reviewer are separate');
  } else {
    const requiredFiles = [
      'dist/index.html',
      'server/http.js',
      'server/mcp.js',
      'sdk/client.mjs',
      'sdk/client.d.ts',
      'templates/external-manager-prompt.md',
      'templates/github-actions-at-hook.yml',
      'schemas/at-team.schema.json'
    ];
    const missing = requiredFiles.filter((file) => !existsSync(resolve(appRoot, file)));
    record('package files', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${requiredFiles.length} required files`);
  }

  const apiResponse = await ensureApi();
  const status = await apiResponse.json();
  record('api status', Array.isArray(status.agents) && status.agents.length === 4, '4 agents available');
  record(
    'api codex transport',
    status.codexCliServer?.kind === 'codex app-server',
    `${status.codexCliServer?.command || ''} connected: ${Boolean(status.codexCliServer?.connected)}`
  );

  if (sourceMode) {
    const auditOutput = run('npm', ['run', 'audit']);
    const audit = parseJsonOutput(auditOutput);
    record('completion audit', audit.checks?.every((check) => check.ok) === true, `cutoff reached: ${audit.cutoffReached}`);
  } else {
    record('completion audit', true, 'source-only check skipped for installed package');
  }

  const pageResponse = await waitFor(`${apiBaseUrl}/`);
  const html = await pageResponse.text();
  record('served UI', html.includes('AT Agent Team'), `${apiBaseUrl}/`);
} catch (error) {
  record('health command', false, error.message);
} finally {
  await Promise.all([stopChild(server), stopChild(codexServer)]);
}

const failed = checks.filter((check) => !check.ok);
if (jsonMode) {
  console.log(JSON.stringify({
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    checks,
    failed
  }, null, 2));
  if (failed.length > 0) process.exit(1);
  process.exit(0);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} health check(s) failed.`);
  process.exit(1);
}

console.log('\nAll health checks passed.');
