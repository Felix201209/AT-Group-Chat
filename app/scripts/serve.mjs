#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || process.env.AT_TEAM_PORT || 5174);
const dataDir = resolve(process.env.AT_TEAM_DB_PATH ? dirname(process.env.AT_TEAM_DB_PATH) : resolve(process.cwd(), 'data'));
const env = {
  ...process.env,
  AT_TEAM_PUBLIC_DIR: process.env.AT_TEAM_PUBLIC_DIR || resolve(appRoot, 'dist')
};

function canListen(host, targetPort) {
  return new Promise((resolveCheck) => {
    const probe = net.createServer();
    probe.once('error', () => resolveCheck(false));
    probe.once('listening', () => {
      probe.close(() => resolveCheck(true));
    });
    probe.listen(targetPort, host);
  });
}

if (!(await canListen('127.0.0.1', port))) {
  console.error(`AT Group Chat serve cannot start: http://127.0.0.1:${port} is already in use.`);
  console.error('Set AT_TEAM_PORT or PORT to another local port and retry.');
  process.exit(1);
}

console.log('AT Group Chat serve');
console.log(`UI/API: http://127.0.0.1:${port}/`);
console.log(`Static dir: ${env.AT_TEAM_PUBLIC_DIR}`);
console.log(`Data dir: ${dataDir}`);

const children = [
  spawn(process.execPath, [resolve(appRoot, 'scripts/codex-server.mjs')], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env
  }),
  spawn(process.execPath, [resolve(appRoot, 'server/http.js')], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env
  })
];
let shuttingDown = false;

function shutdown(signal) {
  shuttingDown = true;
  for (const child of children) child.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      shutdown('SIGTERM');
      process.exit(1);
    }
    if (code && code !== 0) {
      shutdown('SIGTERM');
      process.exit(code);
    }
  });
}
