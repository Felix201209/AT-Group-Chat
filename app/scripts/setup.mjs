#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
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
    hookToken: undefined,
    cors: undefined,
    dbPath: undefined,
    envFile: resolve(process.cwd(), '.env')
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
    else if (arg === '--hook-token') parsed.hookToken = argv[++i] || '';
    else if (arg === '--no-hook-token') parsed.hookToken = '';
    else if (arg === '--cors') parsed.cors = argv[++i] || '';
    else if (arg === '--db') parsed.dbPath = argv[++i] || '';
    else if (arg === '--env-path') parsed.envFile = resolve(process.cwd(), argv[++i] || '.env');
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function usage() {
  return `AT Group Chat terminal setup wizard

Usage:
  npx at-group-chat setup
  at-group-chat setup --real --token auto
  npm run setup
  npm run setup -- --mock --yes

Options:
  -y, --yes          Use safe defaults and do not prompt
  --mock            Configure demo/mock agent mode
  --real            Configure real CLI agent mode
  --token VALUE     Set AT_TEAM_API_TOKEN. Use "auto" to generate one
  --hook-token VAL  Set AT_TEAM_HOOK_TOKEN for webhook/CI ingestion. Use "auto" to generate one
  --no-token        Leave token auth disabled
  --no-hook-token   Leave webhook token auth disabled
  --cors ORIGIN     Set AT_TEAM_CORS_ORIGIN
  --db PATH         Set AT_TEAM_DB_PATH
  --env-path PATH   Write a specific env file
  --force           Overwrite existing managed keys without prompting
  --json            Print machine-readable result
`;
}

function printBanner() {
  console.log('\nAT Group Chat setup');
  console.log('Local manager-controlled AI collaboration platform');
  console.log('This wizard creates .env and checks your local agent CLIs.\n');
}

function printCliStatus(cli) {
  console.log('CLI check:');
  for (const [name, check] of Object.entries(cli)) {
    const label = name.padEnd(7, ' ');
    console.log(`  ${check.ok ? 'OK  ' : 'MISS'} ${label}${check.ok ? check.value : 'not found'}`);
  }
  console.log('');
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

async function select(rl, title, choices, fallbackIndex = 0) {
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`No choices available for ${title}`);
  }
  if (input.isTTY && output.isTTY) {
    return selectWithArrows(title, choices, fallbackIndex);
  }

  console.log(title);
  choices.forEach((choice, index) => {
    const marker = index === fallbackIndex ? ' default' : '';
    console.log(`  ${index + 1}. ${choice.label}${marker}`);
    if (choice.description) console.log(`     ${choice.description}`);
  });
  while (true) {
    const answer = await ask(rl, 'Choose', String(fallbackIndex + 1));
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && choices[index]) {
      console.log('');
      return choices[index];
    }
    console.log(`Please enter 1-${choices.length}.`);
  }
}

function renderChoice(outputStream, title, choices, selectedIndex) {
  outputStream.write('\x1b[?25l');
  outputStream.write(`\n${title}\n`);
  choices.forEach((choice, index) => {
    const active = index === selectedIndex;
    const pointer = active ? '›' : ' ';
    const label = active ? `\x1b[7m ${choice.label} \x1b[0m` : ` ${choice.label} `;
    outputStream.write(`  ${pointer} ${label}\n`);
    if (choice.description) {
      outputStream.write(`    ${active ? choice.description : `\x1b[2m${choice.description}\x1b[0m`}\n`);
    }
  });
  outputStream.write('\nUse ↑/↓ to choose, Enter to continue, q to cancel.\n');
}

function selectWithArrows(title, choices, fallbackIndex = 0) {
  return new Promise((resolve, reject) => {
    let selectedIndex = Math.min(Math.max(fallbackIndex, 0), choices.length - 1);
    const lineCount = choices.reduce((count, choice) => count + 1 + (choice.description ? 1 : 0), 3);
    const cleanup = () => {
      input.off('keypress', onKeypress);
      process.off('SIGINT', cancel);
      if (input.isTTY) input.setRawMode(false);
      output.write('\x1b[?25h');
    };
    const redraw = (initial = false) => {
      if (!initial) output.write(`\x1b[${lineCount}A\x1b[J`);
      renderChoice(output, title, choices, selectedIndex);
    };
    const finish = () => {
      cleanup();
      output.write(`Selected: ${choices[selectedIndex].label}\n\n`);
      resolve(choices[selectedIndex]);
    };
    const cancel = () => {
      cleanup();
      output.write('Setup cancelled.\n');
      const error = new Error('Setup cancelled');
      error.exitCode = 130;
      reject(error);
    };
    const onKeypress = (_str, key = {}) => {
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        redraw();
      } else if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
        selectedIndex = (selectedIndex + 1) % choices.length;
        redraw();
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
      } else if (/^[1-9]$/.test(key.sequence || '')) {
        const numericIndex = Number.parseInt(key.sequence, 10) - 1;
        if (choices[numericIndex]) {
          selectedIndex = numericIndex;
          redraw();
          finish();
        }
      } else if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) {
        cancel();
      }
    };

    emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.on('keypress', onKeypress);
    process.once('SIGINT', cancel);
    redraw(true);
  });
}

async function runInteractiveWizard({ rl, args, existing, cli }) {
  printBanner();
  printCliStatus(cli);

  const profile = await select(rl, 'What kind of setup do you want?', [
    {
      value: 'demo',
      label: 'Demo mode',
      description: 'Uses mock agents. Best for first run, UI demo, and screenshots.'
    },
    {
      value: 'real',
      label: 'Real local agents',
      description: 'Uses Codex, Claude Code, Kimi, or custom CLI adapters installed on this machine.'
    },
    {
      value: 'secure',
      label: 'Secure local agents',
      description: 'Real mode plus generated API token and strict localhost browser origin.'
    },
    {
      value: 'custom',
      label: 'Custom',
      description: 'Choose each setting manually.'
    }
  ], existing.AT_TEAM_AGENT_MODE === 'real' ? 1 : 0);

  let agentMode = args.agentMode || existing.AT_TEAM_AGENT_MODE;
  let token = args.token;
  let hookToken = args.hookToken;
  let cors = args.cors ?? existing.AT_TEAM_CORS_ORIGIN;
  let dbPath = args.dbPath ?? existing.AT_TEAM_DB_PATH;

  if (!agentMode) {
    if (profile.value === 'demo') agentMode = 'mock';
    else if (profile.value === 'real' || profile.value === 'secure') agentMode = 'real';
  }

  if (profile.value === 'custom' && !args.agentMode) {
    const mode = await select(rl, 'Agent execution mode', [
      {
        value: 'mock',
        label: 'mock',
        description: 'Fake agent responses. Safe for demos and first-time setup.'
      },
      {
        value: 'real',
        label: 'real',
        description: 'Actually invokes configured local CLIs/adapters.'
      }
    ], existing.AT_TEAM_AGENT_MODE === 'real' ? 1 : 0);
    agentMode = mode.value;
  }

  if (token === undefined) {
    if (profile.value === 'secure') {
      token = 'auto';
    } else {
      const tokenChoices = [];
      if (existing.AT_TEAM_API_TOKEN) {
        tokenChoices.push({
          value: existing.AT_TEAM_API_TOKEN,
          label: 'Keep existing token',
          description: 'Use the token already present in .env.'
        });
      }
      tokenChoices.push(
        {
          value: 'auto',
          label: 'Generate a local API token',
          description: 'Recommended. Protects HTTP/MCP calls from other local clients.'
        },
        {
          value: '',
          label: 'No token',
          description: 'Lower friction, but any local caller can hit the API.'
        },
        {
          value: 'paste',
          label: 'Paste my own token',
          description: 'Use a token you already generated elsewhere.'
        }
      );
      const tokenChoice = await select(rl, 'API access token', tokenChoices, 0);
      token = tokenChoice.value;
      if (token === 'paste') token = await ask(rl, 'Paste token', '');
    }
  }
  if (token === 'auto') token = makeToken();

  if (hookToken === undefined) {
    if (profile.value === 'secure') {
      hookToken = 'auto';
    } else {
      const hookChoices = [];
      if (existing.AT_TEAM_HOOK_TOKEN) {
        hookChoices.push({
          value: existing.AT_TEAM_HOOK_TOKEN,
          label: 'Keep existing hook token',
          description: 'Use the webhook/CI token already present in .env.'
        });
      }
      hookChoices.push(
        {
          value: 'auto',
          label: 'Generate webhook token',
          description: 'Recommended if GitHub Actions, CI, or external agents will call /api/hooks/events.'
        },
        {
          value: '',
          label: 'No webhook token',
          description: 'Webhook endpoint falls back to the main local API token.'
        }
      );
      const hookChoice = await select(rl, 'Webhook/CI token', hookChoices, 0);
      hookToken = hookChoice.value;
    }
  }
  if (hookToken === 'auto') hookToken = makeToken();

  if (!cors) {
    cors = profile.value === 'secure'
      ? 'http://127.0.0.1:5173'
      : await ask(rl, 'Allowed browser origin', 'http://127.0.0.1:5173');
  } else if (profile.value === 'custom') {
    cors = await ask(rl, 'Allowed browser origin', cors);
  }

  if (!dbPath) {
    dbPath = await ask(rl, 'SQLite database path', './data/at-team.sqlite');
  } else if (profile.value === 'custom') {
    dbPath = await ask(rl, 'SQLite database path', dbPath);
  }

  const summary = {
    profile: profile.value,
    agentMode,
    authEnabled: Boolean(token),
    hookAuthEnabled: Boolean(hookToken),
    cors,
    dbPath,
    envFile: args.envFile
  };

  console.log('Setup summary:');
  console.log(`  Profile: ${summary.profile}`);
  console.log(`  Agent mode: ${summary.agentMode}`);
  console.log(`  API token: ${summary.authEnabled ? 'enabled' : 'disabled'}`);
  console.log(`  Webhook token: ${summary.hookAuthEnabled ? 'enabled' : 'disabled'}`);
  console.log(`  CORS origin: ${summary.cors}`);
  console.log(`  DB path: ${summary.dbPath}`);
  console.log(`  Env file: ${summary.envFile}\n`);

  if (existsSync(args.envFile) && !args.force) {
    const ok = await confirm(rl, 'Update AT managed keys in this env file?', true);
    if (!ok) throw new Error('Setup cancelled');
  } else {
    const ok = await confirm(rl, 'Write this configuration?', true);
    if (!ok) throw new Error('Setup cancelled');
  }

  return { agentMode, token, hookToken, cors, dbPath };
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
    let token = args.token;
    let hookToken = args.hookToken;
    let cors = args.cors ?? existing.AT_TEAM_CORS_ORIGIN;
    let dbPath = args.dbPath ?? existing.AT_TEAM_DB_PATH;

    if (args.yes) {
      if (!agentMode) agentMode = 'mock';
      if (token === undefined) token = existing.AT_TEAM_API_TOKEN && !args.force ? existing.AT_TEAM_API_TOKEN : 'auto';
      if (hookToken === undefined) hookToken = existing.AT_TEAM_HOOK_TOKEN && !args.force ? existing.AT_TEAM_HOOK_TOKEN : 'auto';
      if (!cors) cors = 'http://127.0.0.1:5173';
      if (!dbPath) dbPath = './data/at-team.sqlite';
      if (token === 'auto') token = makeToken();
      if (hookToken === 'auto') hookToken = makeToken();
    } else {
      const selected = await runInteractiveWizard({ rl, args, existing, cli });
      agentMode = selected.agentMode;
      token = selected.token;
      hookToken = selected.hookToken;
      cors = selected.cors;
      dbPath = selected.dbPath;
    }

    if (!['mock', 'real'].includes(agentMode)) throw new Error('Agent mode must be mock or real');

    const updates = {
      AT_TEAM_AGENT_MODE: agentMode,
      AT_TEAM_CORS_ORIGIN: cors,
      AT_TEAM_DB_PATH: dbPath,
      AT_TEAM_RATE_LIMIT_MAX: existing.AT_TEAM_RATE_LIMIT_MAX || '600',
      AT_TEAM_MAX_BODY_BYTES: existing.AT_TEAM_MAX_BODY_BYTES || '1048576',
      AT_TEAM_MAX_TEXT_FIELD_LENGTH: existing.AT_TEAM_MAX_TEXT_FIELD_LENGTH || '32000',
      AT_TEAM_API_TOKEN: token,
      AT_TEAM_HOOK_TOKEN: hookToken
    };
    writeEnv(args.envFile, updates);

    const result = {
      ok: true,
      envFile: args.envFile,
      agentMode,
      authEnabled: Boolean(token),
      hookAuthEnabled: Boolean(hookToken),
      cli,
      nextSteps: [
        'at-group-chat serve',
        'open http://127.0.0.1:5174/',
        'inside the source repo, npm run dev still gives the Vite dev UI at http://127.0.0.1:5173/',
        'at-group-chat chat "请作为 team manager 审查这个项目"',
        'at-group-chat apply-manifest --file at.team.example.json --dry-run'
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
      console.log(`API token: ${token || 'disabled'}`);
      console.log(`Webhook token: ${hookToken || 'disabled'}`);
      if (token || hookToken) {
        console.log('Save these tokens for CLI, SDK, webhook, or external-agent access.');
      }
      console.log('\nCLI availability:');
      for (const [name, check] of Object.entries(cli)) {
        console.log(`  ${check.ok ? 'OK ' : 'MISS'} ${name}${check.ok ? ` - ${check.value}` : ''}`);
      }
      console.log('\nNext:');
      for (const step of result.nextSteps) console.log(`  ${step}`);
      console.log('\nTip: run at-group-chat doctor --json after install.');
      console.log('Tip: external tools can start with `at-group-chat hook --source ci --event test.failed --title "CI failed"`.');
    }
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exit(error.exitCode || 1);
});
