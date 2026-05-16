import { spawn } from 'node:child_process';

const children = [
  spawn('node', ['scripts/codex-server.mjs'], { stdio: 'inherit', env: process.env }),
  spawn('node', ['server/http.js'], { stdio: 'inherit', env: process.env }),
  spawn('vite', ['--host', '127.0.0.1'], {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' }
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
