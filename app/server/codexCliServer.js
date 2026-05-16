import { spawn } from 'node:child_process';
import net from 'node:net';

export const CODEX_APP_SERVER_URL = process.env.CODEX_APP_SERVER_URL || process.env.CODEX_EXEC_SERVER_URL || 'ws://127.0.0.1:5176';
export const CODEX_EXEC_SERVER_URL = CODEX_APP_SERVER_URL;

function parseWsPort(url = CODEX_APP_SERVER_URL) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 80)
  };
}

function readyzUrl(url = CODEX_APP_SERVER_URL) {
  const parsed = new URL(url);
  parsed.protocol = 'http:';
  parsed.pathname = '/readyz';
  return parsed.toString();
}

export function isPortOpen(url = CODEX_APP_SERVER_URL, timeoutMs = 500) {
  const { host, port } = parseWsPort(url);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function isReady(url = CODEX_APP_SERVER_URL) {
  try {
    const response = await fetch(readyzUrl(url), { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getCodexCliServerStatus() {
  const connected = await isReady();
  return {
    kind: 'codex app-server',
    url: CODEX_APP_SERVER_URL,
    connected,
    command: `codex app-server --listen ${CODEX_APP_SERVER_URL}`,
    mode: 'long-running app server',
    readyz: readyzUrl()
  };
}

export async function ensureCodexCliServer({ stdio = 'pipe' } = {}) {
  if (await isReady()) {
    return { alreadyRunning: true, child: null, url: CODEX_APP_SERVER_URL };
  }

  const child = spawn('codex', ['app-server', '--listen', CODEX_APP_SERVER_URL], {
    cwd: process.cwd(),
    env: process.env,
    stdio
  });

  if (child.stdout) child.stdout.on('data', (chunk) => process.stdout.write(`[codex-server] ${chunk}`));
  if (child.stderr) child.stderr.on('data', (chunk) => process.stderr.write(`[codex-server] ${chunk}`));

  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await isReady()) return { alreadyRunning: false, child, url: CODEX_APP_SERVER_URL };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { alreadyRunning: false, child, url: CODEX_APP_SERVER_URL, warning: 'app-server process started but readiness did not pass before timeout' };
}
