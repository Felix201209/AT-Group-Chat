#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    ...options
  }).trim();
}

function json(value) {
  console.log(JSON.stringify(value, null, 2));
}

function hasText(path, needles) {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  return text.length > 100 && needles.every((needle) => text.includes(needle));
}

const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'at-package-smoke-'));
let tarball;
const env = {
  ...process.env,
  AT_SETUP_SKIP_ON_INSTALL: '1',
  AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1'
};

try {
  run('npm', ['run', 'build'], { cwd: root, env });
  const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json'], { cwd: root, env }))[0];
  tarball = join(root, pack.filename);
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module', private: true }, null, 2));
  run('npm', ['install', tarball], { cwd: tmp, env });

  const bin = join(tmp, 'node_modules/.bin/at-group-chat');
  const checks = [];
  checks.push({
    id: 'bin-help',
    ok: run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat init') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat serve') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat doctor --json') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat ask') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat --version') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat watch RUN_ID') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat completion zsh') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat token --env') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat env --json') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat paths') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat template external-manager') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat recipe sdk') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat proposal "Title"') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat work --type review') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat items') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat activity WORK_ITEM_ID') &&
      run(bin, ['--help'], { cwd: tmp, env }).includes('at-group-chat dispatch-work WORK_ITEM_ID')
  });
  checks.push({
    id: 'bin-openapi',
    ok: JSON.parse(run(bin, ['openapi'], { cwd: tmp, env })).info.version === pack.version
  });
  const versionJson = JSON.parse(run(bin, ['version', '--json'], { cwd: tmp, env }));
  checks.push({
    id: 'bin-version',
    ok: run(bin, ['--version'], { cwd: tmp, env }) === `at-group-chat@${pack.version}` &&
      versionJson.version === pack.version &&
      versionJson.openapiVersion === pack.version
  });
  const doctorJson = JSON.parse(run(bin, ['doctor', '--json'], { cwd: tmp, env: { ...env, PORT: '25174', AT_TEAM_PORT: '25174' } }));
  checks.push({
    id: 'bin-doctor-installed',
    ok: doctorJson.ok === true &&
      doctorJson.checks?.some((check) => check.name === 'runtime mode' && String(check.detail).includes('installed package')) &&
      doctorJson.checks?.some((check) => check.name === 'package files' && check.ok === true) &&
      doctorJson.checks?.some((check) => check.name === 'served UI' && check.ok === true)
  });
  const setupEnvPath = join(tmp, 'at-setup-smoke.env');
  const setupJson = JSON.parse(run(bin, ['setup', '--mock', '--yes', '--json', '--env-path', setupEnvPath], { cwd: tmp, env }));
  checks.push({
    id: 'bin-setup-installed',
    ok: setupJson.ok === true &&
      setupJson.agentMode === 'mock' &&
      setupJson.authEnabled === true &&
      existsSync(setupEnvPath) &&
      hasText(setupEnvPath, ['AT_TEAM_AGENT_MODE=mock', 'AT_TEAM_API_TOKEN=', 'AT_TEAM_HOOK_TOKEN='])
  });
  const init = JSON.parse(run(bin, ['init', '--dry-run'], { cwd: tmp, env }));
  checks.push({
    id: 'bin-init-dry-run',
    ok: init.dryRun === true && init.files?.some((file) => file.target.endsWith('at.team.json'))
  });
  const validate = JSON.parse(run(bin, ['validate', '--file', join(tmp, 'node_modules/at-group-chat/at.team.example.json')], { cwd: tmp, env }));
  checks.push({
    id: 'bin-validate',
    ok: validate.ok === true && validate.schema.endsWith('schemas/at-team.schema.json')
  });
  const mcpConfig = JSON.parse(run(bin, ['mcp-config'], { cwd: tmp, env }));
  checks.push({
    id: 'bin-mcp-config',
    ok: mcpConfig.mcpServers?.['at-group-chat']?.args?.some((arg) => arg.endsWith('server/mcp.js'))
  });
  checks.push({
    id: 'bin-completion',
    ok: run(bin, ['completion', 'zsh'], { cwd: tmp, env }).includes('#compdef at-group-chat') &&
      run(bin, ['completion', 'bash'], { cwd: tmp, env }).includes('complete -F _at_group_chat_complete at-group-chat')
  });
  const tokenOutput = run(bin, ['token'], { cwd: tmp, env });
  const tokenResult = JSON.parse(tokenOutput);
  const tokenEnvOutput = run(bin, ['token', '--env'], { cwd: tmp, env });
  checks.push({
    id: 'bin-token',
    ok: tokenResult.ok === true &&
      /^[-_A-Za-z0-9]{32,}$/.test(tokenResult.env?.AT_TEAM_API_TOKEN || '') &&
      /^[-_A-Za-z0-9]{32,}$/.test(tokenResult.env?.AT_TEAM_HOOK_TOKEN || '') &&
      tokenEnvOutput.includes('AT_TEAM_API_TOKEN=') &&
      tokenEnvOutput.includes('AT_TEAM_HOOK_TOKEN=')
  });
  const envOutput = run(bin, ['env'], { cwd: tmp, env });
  const envJson = JSON.parse(run(bin, ['env', '--json'], { cwd: tmp, env }));
  checks.push({
    id: 'bin-env',
    ok: envOutput.includes('AT_TEAM_API_TOKEN=') &&
      envOutput.includes('CODEX_APP_SERVER_URL=') &&
      envJson.docsAvailable === true &&
      envJson.variables?.includes('AT_SETUP_SKIP_ON_INSTALL')
  });
  const paths = JSON.parse(run(bin, ['paths'], { cwd: tmp, env }));
  checks.push({
    id: 'bin-paths',
    ok: paths.ok === true &&
      existsSync(paths.docs?.integrations) &&
      existsSync(paths.templates?.githubActionsHook) &&
      existsSync(paths.examples?.externalManagerSdk)
  });
  const managerTemplate = run(bin, ['template', 'external-manager'], { cwd: tmp, env });
  const teamTemplate = JSON.parse(run(bin, ['template', 'team', '--json'], { cwd: tmp, env }));
  const envTemplate = run(bin, ['template', 'env'], { cwd: tmp, env });
  const githubActionsTemplate = JSON.parse(run(bin, ['template', 'github-actions', '--json'], { cwd: tmp, env }));
  checks.push({
    id: 'bin-template',
    ok: managerTemplate.includes('Manager decision') &&
      envTemplate.includes('AT_TEAM_API_TOKEN=') &&
      githubActionsTemplate.name === 'github-actions' &&
      githubActionsTemplate.path.endsWith('templates/github-actions-at-hook.yml') &&
      githubActionsTemplate.content.includes('AT_TEAM_HOOK_TOKEN') &&
      teamTemplate.ok === true &&
      teamTemplate.name === 'team' &&
      teamTemplate.path.endsWith('at.team.example.json') &&
      teamTemplate.content.includes('AT release review team')
  });
  const sdkRecipe = run(bin, ['recipe', 'sdk'], { cwd: tmp, env });
  const genericCliRecipe = JSON.parse(run(bin, ['recipe', 'generic-cli', '--json'], { cwd: tmp, env }));
  const publishRecipe = JSON.parse(run(bin, ['recipe', 'npm-publish', '--json'], { cwd: tmp, env }));
  checks.push({
    id: 'bin-recipe',
    ok: sdkRecipe.includes('Use AT from a Node.js tool') &&
      sdkRecipe.includes('at-group-chat ask') &&
      genericCliRecipe.ok === true &&
      genericCliRecipe.name === 'generic-cli' &&
      genericCliRecipe.commands?.some((command) => command.includes('apply-manifest')) &&
      publishRecipe.ok === true &&
      publishRecipe.commands?.includes('npm run typecheck') &&
      publishRecipe.commands?.includes('npm test') &&
      publishRecipe.commands?.includes('npm run release:dry-run') &&
      publishRecipe.commands?.includes('at-group-chat version --json') &&
      publishRecipe.commands?.includes('npm publish --dry-run --json')
  });
  const sdk = JSON.parse(run(process.execPath, ['--input-type=module', '-e', "import { createATClient as rootClient } from 'at-group-chat'; import { createATClient as sdkClient } from 'at-group-chat/sdk'; console.log(JSON.stringify({ ok: typeof rootClient === 'function' && typeof sdkClient === 'function' }));"], { cwd: tmp, env }));
  checks.push({ id: 'sdk-import', ok: sdk.ok === true });
  checks.push({
    id: 'templates-installed',
    ok: hasText(join(tmp, 'node_modules/at-group-chat/templates/github-actions-at-hook.yml'), ['AT_TEAM_API_BASE_URL', 'AT_TEAM_HOOK_TOKEN']) &&
      hasText(join(tmp, 'node_modules/at-group-chat/templates/external-manager-prompt.md'), ['team manager', 'manager-controlled']) &&
      hasText(join(tmp, 'node_modules/at-group-chat/examples/external-manager-sdk.mjs'), ['createATClient', 'AT_TEAM_API_BASE_URL', 'runEvents'])
  });
  checks.push({
    id: 'dist-installed',
    ok: existsSync(join(tmp, 'node_modules/at-group-chat/dist/index.html'))
  });
  checks.push({
    id: 'schema-installed',
    ok: hasText(join(tmp, 'node_modules/at-group-chat/schemas/at-team.schema.json'), ['AT Group Chat Team Manifest', 'dangerousCommandTemplate'])
  });

  const failed = checks.filter((check) => !check.ok);
  json({
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    tarball: pack.filename,
    tempProject: tmp,
    checks
  });
  if (failed.length) process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
