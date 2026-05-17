#!/usr/bin/env node
import { openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skip =
  process.env.CI ||
  process.env.AT_SETUP_SKIP_ON_INSTALL ||
  process.env.npm_config_ignore_scripts === 'true';

if (skip) process.exit(0);

let tty;
try {
  tty = openSync('/dev/tty', 'r+');
} catch {
  console.error(`
AT Group Chat installed.

Start the terminal setup wizard:
  npx at-group-chat setup

Or, inside a cloned project:
  npm run setup
`);
  process.exit(0);
}

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installCwd = process.env.INIT_CWD || process.cwd();
const envPath = resolve(installCwd, '.env');
const setupScript = resolve(appRoot, 'scripts/setup.mjs');

const result = spawnSync(process.execPath, [setupScript, '--env-path', envPath], {
  cwd: installCwd,
  stdio: [tty, tty, tty],
  env: process.env
});

if (result.error) {
  console.error(`AT Group Chat setup wizard could not start: ${result.error.message}`);
  console.error('Run it manually with: npx at-group-chat setup');
}
