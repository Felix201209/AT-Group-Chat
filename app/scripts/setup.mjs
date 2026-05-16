#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const parsed = {
    yes: false,
    force: false,
    json: false,
    agentMode: null,
    token: undefined,
    cors: undefined,
    dbPath: undefined,
    envFile: resolve(appRoot, '.env')
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'setup') continue;
    if (arg === '--yes' || arg === '-y') parsed.yes = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--mock') parsed.agentMode = 'mock';
    else if (arg === '--real') parsed.agentMode = 'real';
    else if (arg === '--no-token') parsed.token = '';
    else if (arg === '--token') parsed.token = argv[++i] || '';
    else if (arg === '--cors') parsed.cors = argv[++i] || '';
    else if (arg === '--db') parsed.dbPath = argv[++i] || '';
    else if (arg === '--env-path') parsed.envFile = resolve(process.cwd(), argv[++i] || '.env');
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function usage() {
  return `AT Group Chat setup wizard

Usage:
  npm run setup
  npm run setup -- --mock --yes
  node scripts/setup.mjs --real --token auto

Options:
  -y, --yes          Use safe defaults and do not prompt
  --mock            Configure demo/mock agent mode
  --real            Configure real CLI agent mode
  --token VALUE     Set AT_TEAM_API_TOKEN. Use "auto" to generate one
  --no-token        Leave token auth disabled
  --cors ORIGIN     Set AT_TEAM_CORS_ORIGIN
  --db PATH         Set AT_TEAM_DB_PATH
  --env-path PATH   Write a specific env file
  --force           Overwrite existing managed keys without prompting
  --json            Print machine-readable result
`;
}

function commandVersion(command, args = ['--version']) {
  try {
    return {
      ok: true,
      value: execFileSync(command, args, {
        cwd: appRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024
      }).trim()
    };
  } catch (error) {
    return { ok: false, value: error.message };
  }
}

function readEnv(file) {
  if (!existsSync(file)) return { lines: [], values: {} };
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const values = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return { lines, values };
}

function quoteEnv(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:@-]*$/.test(text)) return text;
  return JSON.stringify(text);
}

function writeEnv(file, updates) {
  const managedKeys = Object.keys(updates);
  const { lines } = readEnv(file);
  const seen = new Set();
  const next = lines.filter((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    if (!key || !managedKeys.includes(key)) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return false;
  }).filter((line, index, arr) => !(line === '' && index === arr.length - 1));

  if (next.length > 0 && next[next.length - 1] !== '') next.push('');
  next.push('# AT Group Chat setup wizard');
  for (const key of managedKeys) {
    const value = updates[key];
    if (value !== undefined && value !== null && value !== '') next.push(`${key}=${quoteEnv(value)}`);
  }
  next.push('');
  writeFileSync(file, next.join('\n'));
}

async function ask(rl, question, fallback) {
  const suffix = fallback === undefined ? '' : ` (${fallback})`;
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || fallback;
}

async function confirm(rl, question, fallback = true) {
  const answer = await ask(rl, `${question} ${fallback ? '[Y/n]' : '[y/N]'}`, '');
  if (!answer) return fallback;
  return /^y(es)?$/i.test(answer);
}

function makeToken() {
  return `at_${randomBytes(24).toString('base64url')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const cli = {
    node: commandVersion('node'),
    npm: commandVersion('npm'),
    codex: commandVersion('codex'),
    claude: commandVersion('claude'),
    kimi: commandVersion('kimi')
  };

  const rl = args.yes ? null : createInterface({ input, output });
  try {
    const existing = readEnv(args.envFile).values;
    let agentMode = args.agentMode || existing.AT_TEAM_AGENT_MODE;
    if (!agentMode) {
      agentMode = args.yes ? 'mock' : await ask(rl, 'Agent mode: mock for demo, real for local CLIs [mock/real]', 'mock');
    }
    if (!['mock', 'real'].includes(agentMode)) throw new Error('Agent mode must be mock or real');

    let token = args.token;
    if (token === undefined) {
      if (existing.AT_TEAM_API_TOKEN && !args.force) token = existing.AT_TEAM_API_TOKEN;
      else if (args.yes) token = 'auto';
      else token = await ask(rl, 'API token: type auto, empty to disable, or paste a token', 'auto');
    }
    if (token === 'auto') token = makeToken();

    let cors = args.cors ?? existing.AT_TEAM_CORS_ORIGIN;
    if (!cors) cors = args.yes ? 'http://127.0.0.1:5173' : await ask(rl, 'Allowed browser origin', 'http://127.0.0.1:5173');

    let dbPath = args.dbPath ?? existing.AT_TEAM_DB_PATH;
    if (!dbPath) dbPath = args.yes ? './data/at-team.sqlite' : await ask(rl, 'SQLite database path', './data/at-team.sqlite');

    if (existsSync(args.envFile) && !args.force && !args.yes) {
      const ok = await confirm(rl, `${args.envFile} already exists. Update AT managed keys?`, true);
      if (!ok) throw new Error('Setup cancelled');
    }

    const updates = {
      AT_TEAM_AGENT_MODE: agentMode,
      AT_TEAM_CORS_ORIGIN: cors,
      AT_TEAM_DB_PATH: dbPath,
      AT_TEAM_RATE_LIMIT_MAX: existing.AT_TEAM_RATE_LIMIT_MAX || '600',
      AT_TEAM_MAX_BODY_BYTES: existing.AT_TEAM_MAX_BODY_BYTES || '1048576',
      AT_TEAM_MAX_TEXT_FIELD_LENGTH: existing.AT_TEAM_MAX_TEXT_FIELD_LENGTH || '32000',
      AT_TEAM_API_TOKEN: token
    };
    writeEnv(args.envFile, updates);

    const result = {
      ok: true,
      envFile: args.envFile,
      agentMode,
      authEnabled: Boolean(token),
      cli,
      nextSteps: [
        'npm install',
        'npm run dev',
        'open http://127.0.0.1:5173/'
      ],
      notes: [
        agentMode === 'real'
          ? 'Real mode expects the configured Codex, Claude, Kimi, or custom CLI adapters to be installed and authenticated.'
          : 'Mock mode is best for demos, UI checks, and first-time setup.',
        'Use npm run health after install for a full local readiness check.'
      ]
    };

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\nAT setup complete.');
      console.log(`Env file: ${result.envFile}`);
      console.log(`Agent mode: ${agentMode}`);
      console.log(`API token: ${token ? 'enabled' : 'disabled'}`);
      console.log('\nCLI availability:');
      for (const [name, check] of Object.entries(cli)) {
        console.log(`  ${check.ok ? 'OK ' : 'MISS'} ${name}${check.ok ? ` - ${check.value}` : ''}`);
      }
      console.log('\nNext:');
      for (const step of result.nextSteps) console.log(`  ${step}`);
      console.log('\nTip: run npm run health after install.');
    }
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exit(1);
});
