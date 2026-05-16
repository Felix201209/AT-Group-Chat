#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATClient } from '../sdk/client.mjs';
import { openApiSpec } from '../server/openapi.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `AT Group Chat CLI

Usage:
  at-group-chat setup
  at-group-chat serve
  at-group-chat doctor
  at-group-chat doctor --json
  at-group-chat --version
  at-group-chat version --json
  at-group-chat status
  at-group-chat init --github --manager-prompt
  at-group-chat ask "Ask manager to review this project" [--json] [--max N]
  at-group-chat chat "Ask manager to review this project"
  at-group-chat issue "Title" --body "Details" --dispatch
  at-group-chat proposal "Title" --body "Implementation plan" --dispatch
  at-group-chat review "Title" --body "Review notes"
  at-group-chat decision "Title" --body "Final decision"
  at-group-chat artifact "Title" --body "Artifact URL or path"
  at-group-chat work --type review "Title" --body "Details"
  at-group-chat items
  at-group-chat activity WORK_ITEM_ID
  at-group-chat dispatch-work WORK_ITEM_ID --permission readonly
  at-group-chat hook --source ci --event test.failed --title "Tests failed" --body "Attach logs"
  at-group-chat validate --file at.team.json
  at-group-chat apply-manifest --file at.team.json
  at-group-chat apply-manifest --file at.team.json --dry-run
  at-group-chat watch RUN_ID --max 20
  at-group-chat mcp-config
  at-group-chat token
  at-group-chat token --env
  at-group-chat env
  at-group-chat env --json
  at-group-chat paths
  at-group-chat template external-manager
  at-group-chat template github-actions
  at-group-chat template team
  at-group-chat template env
  at-group-chat recipe sdk
  at-group-chat recipe external-manager
  at-group-chat recipe github-actions
  at-group-chat recipe generic-cli
  at-group-chat recipe mcp
  at-group-chat recipe npm-publish
  at-group-chat openapi

Environment:
  AT_TEAM_API_BASE_URL  default http://127.0.0.1:5174
  AT_TEAM_API_TOKEN     optional local API token
  AT_TEAM_HOOK_TOKEN    optional webhook ingestion token used by hook
`;
}

function readFlag(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function positionalArgs(argv, flagsWithValues = []) {
  const flags = new Set(flagsWithValues);
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (flags.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) continue;
    values.push(arg);
  }
  return values;
}

function json(value) {
  console.log(JSON.stringify(value, null, 2));
}

function packageInfo(args) {
  const packagePath = resolve(appRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const info = {
    ok: true,
    name: pkg.name,
    version: pkg.version,
    openapiVersion: openApiSpec.info?.version,
    homepage: pkg.homepage,
    repository: pkg.repository?.url,
    packagePath
  };
  if (hasFlag(args, '--json')) return info;
  return `${info.name}@${info.version}`;
}

function mcpConfig(args) {
  const name = readFlag(args, '--name', 'at-group-chat');
  const apiBaseUrl = readFlag(args, '--api-base-url', process.env.AT_TEAM_API_BASE_URL || 'http://127.0.0.1:5174');
  const dataPath = readFlag(args, '--db', process.env.AT_TEAM_DB_PATH || './data/at-team.sqlite');
  const env = {
    AT_TEAM_API_BASE_URL: apiBaseUrl,
    AT_TEAM_DB_PATH: dataPath,
    AT_SETUP_SKIP_ON_INSTALL: '1'
  };
  if (process.env.AT_TEAM_API_TOKEN) env.AT_TEAM_API_TOKEN = process.env.AT_TEAM_API_TOKEN;
  if (process.env.AT_TEAM_HOOK_TOKEN) env.AT_TEAM_HOOK_TOKEN = process.env.AT_TEAM_HOOK_TOKEN;
  return {
    mcpServers: {
      [name]: {
        command: process.execPath,
        args: [resolve(appRoot, 'server/mcp.js')],
        env
      }
    },
    notes: [
      'Use this JSON in MCP clients that accept mcpServers config.',
      'Keep AT_TEAM_API_TOKEN and AT_TEAM_HOOK_TOKEN in your shell or secret store; do not commit real tokens.',
      'The MCP server uses the same AT runtime/storage model as HTTP and UI.'
    ]
  };
}

function generateToken(args) {
  const apiToken = randomBytes(32).toString('base64url');
  const hookToken = randomBytes(32).toString('base64url');
  if (hasFlag(args, '--env')) {
    return [
      `AT_TEAM_API_TOKEN=${apiToken}`,
      `AT_TEAM_HOOK_TOKEN=${hookToken}`
    ].join('\n');
  }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    env: {
      AT_TEAM_API_TOKEN: apiToken,
      AT_TEAM_HOOK_TOKEN: hookToken
    },
    next: [
      'Add these values to .env or your shell before starting AT.',
      'Use AT_TEAM_API_TOKEN for admin HTTP/MCP calls.',
      'Use AT_TEAM_HOOK_TOKEN for CI/webhook ingestion only.'
    ]
  };
}

function envReference(args) {
  const examplePath = resolve(appRoot, 'env.example');
  const docsPath = resolve(appRoot, 'docs/environment.md');
  const example = readFileSync(examplePath, 'utf8');
  if (!hasFlag(args, '--json')) return example;
  const variables = [...new Set([...example.matchAll(/^([A-Za-z_][A-Za-z0-9_]+)=/gm)].map((match) => match[1]))];
  return {
    ok: true,
    examplePath,
    docsPath,
    docsAvailable: existsSync(docsPath),
    variables,
    next: [
      'Copy env.example to .env or export only the variables you need.',
      'Generate real tokens with `at-group-chat token --env`.',
      'Read docs/environment.md before exposing AT to other tools or machines.'
    ]
  };
}

function resourcePaths() {
  return {
    ok: true,
    appRoot,
    files: {
      readme: resolve(appRoot, 'README.md'),
      security: resolve(appRoot, 'SECURITY.md'),
      envExample: resolve(appRoot, 'env.example'),
      teamExample: resolve(appRoot, 'at.team.example.json'),
      openapi: resolve(appRoot, 'server/openapi.js'),
      mcpServer: resolve(appRoot, 'server/mcp.js'),
      schema: resolve(appRoot, 'schemas/at-team.schema.json'),
      sdk: resolve(appRoot, 'sdk/client.mjs')
    },
    docs: {
      integrations: resolve(appRoot, 'docs/integrations.md'),
      environment: resolve(appRoot, 'docs/environment.md'),
      developerRecipes: resolve(appRoot, 'docs/developer-recipes.md'),
      managerSkill: resolve(appRoot, 'docs/agent-manager-skill.md'),
      releaseNotes: resolve(appRoot, 'docs/release-notes-1.1.0.md')
    },
    templates: {
      githubActionsHook: resolve(appRoot, 'templates/github-actions-at-hook.yml'),
      externalManagerPrompt: resolve(appRoot, 'templates/external-manager-prompt.md')
    },
    examples: {
      externalManagerSdk: resolve(appRoot, 'examples/external-manager-sdk.mjs'),
      ciHook: resolve(appRoot, 'examples/ci-hook.sh')
    },
    notes: [
      '`files.openapi` points to the packaged OpenAPI module; use `at-group-chat openapi` when a static JSON document is required.'
    ]
  };
}

const templateSources = {
  'external-manager': 'templates/external-manager-prompt.md',
  'github-actions': 'templates/github-actions-at-hook.yml',
  team: 'at.team.example.json',
  env: 'env.example'
};

function templateContent(args) {
  const name = positionalArgs(args)[0];
  if (!name || !templateSources[name]) {
    throw new Error(`template name must be one of: ${Object.keys(templateSources).join(', ')}`);
  }
  const path = resolve(appRoot, templateSources[name]);
  const content = readFileSync(path, 'utf8');
  if (!hasFlag(args, '--json')) return content;
  return { ok: true, name, path, content };
}

const recipes = {
  sdk: {
    title: 'Use AT from a Node.js tool or external manager',
    goal: 'Create work, post manager tasks, and stream run events through the typed JavaScript SDK.',
    steps: [
      'Start the local AT API with `at-group-chat serve`.',
      'Keep AT_TEAM_API_BASE_URL and AT_TEAM_API_TOKEN in your shell or secret store.',
      'Import createATClient from the package and create work/chat tasks.'
    ],
    commands: [
      'npm install at-group-chat',
      'at-group-chat serve',
      'at-group-chat ask "Act as manager: create one review item for this repo."',
      'node --input-type=module -e "import { createATClient } from \'at-group-chat/sdk\'; const at = createATClient(); console.log(await at.status());"'
    ],
    files: ['sdk/client.mjs', 'sdk/client.d.ts', 'examples/external-manager-sdk.mjs'],
    docs: ['docs/integrations.md#node-sdk', 'docs/developer-recipes.md#use-the-javascript-sdk-from-another-local-agent']
  },
  'external-manager': {
    title: 'Let Codex, Qwen, Claude, or another AI act as manager',
    goal: 'Give an outside AI a bounded contract: create one task, choose one role, watch events, then stop.',
    steps: [
      'Copy the manager contract into the agent that will coordinate AT.',
      'Have the manager create one chat task or work item.',
      'Watch the returned run until completion and stop unless the human asks for another dispatch.'
    ],
    commands: [
      'mkdir -p docs && at-group-chat template external-manager > docs/at-external-manager.md',
      'at-group-chat chat "Act as manager: inspect this repo and decide one next specialist."',
      'at-group-chat watch <runId> --max 20'
    ],
    files: ['templates/external-manager-prompt.md', 'docs/agent-manager-skill.md'],
    docs: ['docs/integrations.md#external-manager-contract']
  },
  'github-actions': {
    title: 'Convert CI failures into AT issues',
    goal: 'Use a webhook token so CI can create work items without broad admin access.',
    steps: [
      'Generate a separate hook token and save it as a CI secret.',
      'Install the workflow template in the repository that should report failures.',
      'Keep the AT API reachable only from trusted networks or tunnels.'
    ],
    commands: [
      'at-group-chat token --env',
      'mkdir -p .github/workflows',
      'at-group-chat template github-actions > .github/workflows/at-hook.yml',
      'at-group-chat hook --source ci --event test.failed --title "CI failed" --dispatch'
    ],
    files: ['templates/github-actions-at-hook.yml', 'examples/ci-hook.sh'],
    docs: ['docs/integrations.md#github-actions--ci']
  },
  'generic-cli': {
    title: 'Attach any local model CLI as an AT role',
    goal: 'Use the generic-cli adapter when a model can read a prompt file and print a final answer.',
    steps: [
      'Create or edit at.team.json.',
      'Add an agent with adapter: "generic-cli", command, commandTemplate, model, and responsibility.',
      'Validate first, then dry-run apply before touching the live runtime.'
    ],
    commands: [
      'at-group-chat init --dry-run',
      'at-group-chat validate --file at.team.json',
      'at-group-chat apply-manifest --file at.team.json --dry-run'
    ],
    files: ['at.team.example.json', 'schemas/at-team.schema.json'],
    docs: ['docs/integrations.md#generic-cli-agent', 'docs/developer-recipes.md#generic-cli-adapter-recipe']
  },
  mcp: {
    title: 'Expose AT to MCP-capable tools',
    goal: 'Generate an mcpServers block that points to the packaged AT MCP server and shared runtime.',
    steps: [
      'Generate the config from the same environment that will run AT.',
      'Copy only the mcpServers.at-group-chat block into the client.',
      'Keep real tokens outside committed files.'
    ],
    commands: [
      'at-group-chat mcp-config > at-mcp.json',
      'at-group-chat status'
    ],
    files: ['server/mcp.js'],
    docs: ['docs/integrations.md#external-manager-contract']
  },
  'npm-publish': {
    title: 'Publish a verified AT npm release',
    goal: 'Run local package, runtime, and installed-tarball checks before npm publish.',
    steps: [
      'Confirm package.json, OpenAPI, UI constants, README, and release notes use the same version.',
      'Run local tests and installed tarball smoke before publishing.',
      'Publish only after npm auth and 2FA state are known.'
    ],
    commands: [
      'at-group-chat version --json',
      'npm run typecheck',
      'npm test',
      'npm run package:smoke',
      'npm run release:readiness',
      'npm run release:dry-run',
      'npm publish --dry-run --json',
      'npm publish --tag latest'
    ],
    files: ['docs/release-notes-1.1.0.md', 'scripts/package-smoke.mjs', 'scripts/release-readiness.mjs'],
    docs: ['docs/developer-recipes.md#check-release-readiness']
  }
};

function recipeContent(args) {
  const name = positionalArgs(args)[0];
  if (!name || !recipes[name]) {
    throw new Error(`recipe name must be one of: ${Object.keys(recipes).join(', ')}`);
  }
  const recipe = {
    ok: true,
    name,
    ...recipes[name]
  };
  if (hasFlag(args, '--json')) return recipe;
  return [
    `# ${recipe.title}`,
    '',
    recipe.goal,
    '',
    '## Steps',
    ...recipe.steps.map((step) => `- ${step}`),
    '',
    '## Commands',
    ...recipe.commands.map((command) => `- ${command}`),
    '',
    '## Files',
    ...recipe.files.map((file) => `- ${file}`),
    '',
    '## Docs',
    ...recipe.docs.map((doc) => `- ${doc}`)
  ].join('\n');
}

function compact(value, max = 220) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function watchRunEvents(client, runId, args) {
  if (!runId) throw new Error('runId is required to watch run events');
  const max = Number(readFlag(args, '--max', '0'));
  const after = Number(readFlag(args, '--after', '0'));
  let count = 0;
  for await (const event of client.runEvents(runId, { after })) {
    if (hasFlag(args, '--json')) {
      console.log(JSON.stringify(event));
    } else {
      const role = event.role_id ? ` ${event.role_id}` : '';
      console.log(`[${event.id}] ${event.type}${role} ${compact(event.payload || '')}`);
    }
    count += 1;
    if (event.type === 'agent.completed' || event.type === 'agent.failed' || event.type === 'run.failed') break;
    if (max && count >= max) {
      console.error(`max events reached (${max}); run may still be active`);
      break;
    }
  }
}

const permissionProfiles = new Set(['readonly', 'write-proposed', 'workspace-write', 'danger']);
const thinkingLevels = new Set(['default', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const workItemTypes = new Set(['issue', 'proposal', 'review', 'decision', 'artifact']);
const workItemStatuses = new Set(['open', 'in-progress', 'review', 'accepted', 'closed']);
const priorities = new Set(['low', 'medium', 'high', 'urgent']);
const manifestRootKeys = new Set(['$schema', 'name', 'version', 'projectId', 'defaults', 'agents', 'workItems']);
const manifestDefaultKeys = new Set(['roleIds', 'model', 'thinkingLevel', 'defaultPermission', 'adapter', 'command', 'commandTemplate', 'dangerousCommandTemplate']);
const manifestAgentKeys = new Set(['roleId', 'name', 'cli', 'adapter', 'command', 'commandTemplate', 'model', 'thinkingLevel', 'responsibility', 'defaultPermission', 'dangerousCommandTemplate']);
const manifestWorkItemKeys = new Set(['type', 'title', 'body', 'status', 'priority', 'assignedRoleId', 'linkedRunId', 'parentId', 'metadata', 'dispatchToManager', 'permissionProfile']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(value, allowed) {
  return Object.keys(value || {}).filter((key) => !allowed.has(key));
}

function assertEnum(errors, value, allowed, path) {
  if (value !== undefined && !allowed.has(value)) errors.push(`${path} must be one of: ${[...allowed].join(', ')}`);
}

function assertManifestCommandTemplate(errors, agent, path) {
  if (!agent.commandTemplate) return;
  const hasShellControl = /(?:;|&&|\||`|\$\(|\n|\r)/.test(String(agent.commandTemplate));
  if (hasShellControl && agent.dangerousCommandTemplate !== true) {
    errors.push(`${path}.commandTemplate contains shell control syntax; set dangerousCommandTemplate: true to opt in explicitly`);
  }
}

function validateManifest(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return ['manifest must be an object'];
  }
  const rootUnknown = unknownKeys(manifest, manifestRootKeys);
  if (rootUnknown.length) errors.push(`manifest has unknown field(s): ${rootUnknown.join(', ')}`);
  if (manifest.defaults !== undefined) {
    if (!isPlainObject(manifest.defaults)) {
      errors.push('manifest.defaults must be an object');
    } else {
      const unknown = unknownKeys(manifest.defaults, manifestDefaultKeys);
      if (unknown.length) errors.push(`manifest.defaults has unknown field(s): ${unknown.join(', ')}`);
      if (manifest.defaults.roleIds !== undefined && !Array.isArray(manifest.defaults.roleIds)) errors.push('manifest.defaults.roleIds must be an array');
      assertEnum(errors, manifest.defaults.thinkingLevel, thinkingLevels, 'manifest.defaults.thinkingLevel');
      assertEnum(errors, manifest.defaults.defaultPermission, permissionProfiles, 'manifest.defaults.defaultPermission');
      assertManifestCommandTemplate(errors, manifest.defaults, 'manifest.defaults');
    }
  }
  if (manifest.agents !== undefined && !Array.isArray(manifest.agents)) errors.push('manifest.agents must be an array');
  (Array.isArray(manifest.agents) ? manifest.agents : []).forEach((agent, index) => {
    const path = `manifest.agents[${index}]`;
    if (!isPlainObject(agent)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const unknown = unknownKeys(agent, manifestAgentKeys);
    if (unknown.length) errors.push(`${path} has unknown field(s): ${unknown.join(', ')}`);
    if (!agent.roleId) errors.push(`${path}.roleId is required`);
    assertEnum(errors, agent.thinkingLevel, thinkingLevels, `${path}.thinkingLevel`);
    assertEnum(errors, agent.defaultPermission, permissionProfiles, `${path}.defaultPermission`);
    assertManifestCommandTemplate(errors, agent, path);
  });
  if (manifest.workItems !== undefined && !Array.isArray(manifest.workItems)) errors.push('manifest.workItems must be an array');
  (Array.isArray(manifest.workItems) ? manifest.workItems : []).forEach((item, index) => {
    const path = `manifest.workItems[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    const unknown = unknownKeys(item, manifestWorkItemKeys);
    if (unknown.length) errors.push(`${path} has unknown field(s): ${unknown.join(', ')}`);
    if (!item.title) errors.push(`${path}.title is required`);
    assertEnum(errors, item.type, workItemTypes, `${path}.type`);
    assertEnum(errors, item.status, workItemStatuses, `${path}.status`);
    assertEnum(errors, item.priority, priorities, `${path}.priority`);
    assertEnum(errors, item.permissionProfile, permissionProfiles, `${path}.permissionProfile`);
  });
  return errors;
}

function writeTemplate({ source, target, force = false, dryRun = false }) {
  const existed = existsSync(target);
  if (existed && !force) {
    return { target, source, action: 'skipped', reason: 'exists' };
  }
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source, 'utf8'));
  }
  return { target, source, action: existed ? 'overwritten' : 'created' };
}

function initRepo(args) {
  const cwd = process.cwd();
  const force = hasFlag(args, '--force');
  const dryRun = hasFlag(args, '--dry-run');
  const includeGitHub = hasFlag(args, '--github') || !hasFlag(args, '--no-github');
  const includeManagerPrompt = hasFlag(args, '--manager-prompt') || !hasFlag(args, '--no-manager-prompt');
  const files = [
    {
      source: resolve(appRoot, 'at.team.example.json'),
      target: resolve(cwd, readFlag(args, '--manifest', 'at.team.json'))
    }
  ];
  if (includeGitHub) {
    files.push({
      source: resolve(appRoot, 'templates/github-actions-at-hook.yml'),
      target: resolve(cwd, readFlag(args, '--github-file', '.github/workflows/at-hook.yml'))
    });
  }
  if (includeManagerPrompt) {
    files.push({
      source: resolve(appRoot, 'templates/external-manager-prompt.md'),
      target: resolve(cwd, readFlag(args, '--prompt-file', 'docs/at-external-manager.md'))
    });
  }
  const results = files.map((file) => writeTemplate({ ...file, force, dryRun }));
  return {
    ok: true,
    dryRun,
    cwd,
    files: results,
    next: [
      'Review at.team.json for your repo roles and work items.',
      'Set AT_TEAM_API_BASE_URL and AT_TEAM_HOOK_TOKEN if you use the GitHub Actions hook.',
      'Run `at-group-chat validate --file at.team.json`.',
      'Run `at-group-chat apply-manifest --file at.team.json --dry-run`.',
      'Run `at-group-chat apply-manifest --file at.team.json` when ready.'
    ]
  };
}

function summarizeManifest(manifest, file) {
  const defaults = manifest.defaults && Object.keys(manifest.defaults).length
    ? Object.keys(manifest.defaults).filter((key) => key !== 'roleIds')
    : [];
  const agents = Array.isArray(manifest.agents) ? manifest.agents : [];
  const workItems = Array.isArray(manifest.workItems) ? manifest.workItems : [];
  return {
    dryRun: true,
    file,
    manifest: {
      name: manifest.name || 'AT team manifest',
      version: manifest.version || '1'
    },
    changes: {
      defaults: defaults.length ? defaults : [],
      targetRoles: manifest.defaults?.roleIds || 'all active roles',
      agents: agents.map((agent) => ({
        roleId: agent.roleId,
        adapter: agent.adapter,
        model: agent.model,
        commandTemplate: agent.commandTemplate ? 'present' : 'not-set',
        dangerousCommandTemplate: agent.dangerousCommandTemplate === true
      })),
      workItems: workItems.map((item, index) => ({
        index,
        type: item.type || 'issue',
        title: item.title,
        manifestKey: item.metadata?.manifestKey
          || item.metadata?.idempotencyKey
          || item.metadata?.dedupeKey
          || `${manifest.name || 'AT team manifest'}:${manifest.version || '1'}:${item.type || 'issue'}:${item.title || index}`
      }))
    },
    next: 'Run the same command without --dry-run to apply this manifest to the local AT runtime.'
  };
}

async function createWorkItemFromCli(client, args, defaultType = 'issue') {
  const type = readFlag(args, '--type', defaultType);
  if (!workItemTypes.has(type)) throw new Error(`--type must be one of: ${[...workItemTypes].join(', ')}`);
  const title = positionalArgs(args, ['--type', '--body', '--permission', '--project', '--priority', '--assigned-role', '--parent'])[0];
  if (!title) throw new Error(`${defaultType} title is required`);
  return client.createWorkItem({
    projectId: readFlag(args, '--project') || undefined,
    type,
    title,
    body: readFlag(args, '--body', ''),
    priority: readFlag(args, '--priority', 'medium'),
    assignedRoleId: readFlag(args, '--assigned-role') || undefined,
    parentId: readFlag(args, '--parent') || undefined,
    dispatchToManager: hasFlag(args, '--dispatch'),
    permissionProfile: readFlag(args, '--permission', 'write-proposed')
  });
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const client = new ATClient();

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    const result = packageInfo(args);
    if (typeof result === 'string') console.log(result);
    else json(result);
    return;
  }
  if (command === 'setup') {
    const result = spawnSync(process.execPath, [resolve(appRoot, 'scripts/setup.mjs'), ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env
    });
    process.exit(result.status ?? 0);
  }
  if (command === 'serve' || command === 'start') {
    const result = spawnSync(process.execPath, [resolve(appRoot, 'scripts/serve.mjs'), ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env
    });
    process.exit(result.status ?? 0);
  }
  if (command === 'doctor' || command === 'health') {
    const result = spawnSync(process.execPath, [resolve(appRoot, 'scripts/health.mjs'), ...args], {
      cwd: appRoot,
      stdio: 'inherit',
      env: process.env
    });
    process.exit(result.status ?? 0);
  }
  if (command === 'status') {
    json(await client.status(readFlag(args, '--project')));
    return;
  }
  if (command === 'room') {
    json(await client.room(readFlag(args, '--project')));
    return;
  }
  if (command === 'openapi') {
    json(openApiSpec);
    return;
  }
  if (command === 'mcp-config') {
    json(mcpConfig(args));
    return;
  }
  if (command === 'token') {
    const result = generateToken(args);
    if (typeof result === 'string') console.log(result);
    else json(result);
    return;
  }
  if (command === 'env') {
    const result = envReference(args);
    if (typeof result === 'string') console.log(result.trimEnd());
    else json(result);
    return;
  }
  if (command === 'paths') {
    json(resourcePaths());
    return;
  }
  if (command === 'template') {
    const result = templateContent(args);
    if (typeof result === 'string') console.log(result.trimEnd());
    else json(result);
    return;
  }
  if (command === 'recipe') {
    const result = recipeContent(args);
    if (typeof result === 'string') console.log(result.trimEnd());
    else json(result);
    return;
  }
  if (command === 'init') {
    json(initRepo(args));
    return;
  }
  if (command === 'chat') {
    const content = positionalArgs(args, ['--permission', '--project']).join(' ').trim();
    if (!content) throw new Error('chat content is required');
    json(await client.chat({
      projectId: readFlag(args, '--project') || undefined,
      content,
      permissionProfile: readFlag(args, '--permission', 'write-proposed')
    }));
    return;
  }
  if (command === 'ask' || command === 'run') {
    const content = positionalArgs(args, ['--permission', '--project', '--after', '--max']).join(' ').trim();
    if (!content) throw new Error(`${command} content is required`);
    const response = await client.chat({
      projectId: readFlag(args, '--project') || undefined,
      content,
      permissionProfile: readFlag(args, '--permission', 'write-proposed')
    });
    if (!response.run?.id) throw new Error('chat task was accepted but no run id was returned');
    if (hasFlag(args, '--json')) {
      console.log(JSON.stringify({ type: 'chat.accepted', runId: response.run?.id, response }));
    } else {
      console.log(`run ${response.run?.id}`);
    }
    await watchRunEvents(client, response.run?.id, args);
    return;
  }
  if (command === 'issue') {
    json(await createWorkItemFromCli(client, args, 'issue'));
    return;
  }
  if (['work', 'proposal', 'review', 'decision', 'artifact'].includes(command)) {
    json(await createWorkItemFromCli(client, args, command === 'work' ? 'issue' : command));
    return;
  }
  if (command === 'items' || command === 'work-items') {
    json(await client.workItems(readFlag(args, '--project') || undefined));
    return;
  }
  if (command === 'activity') {
    const itemId = positionalArgs(args, ['--project'])[0];
    if (!itemId) throw new Error('activity WORK_ITEM_ID is required');
    json(await client.workItemActivity(itemId, readFlag(args, '--project') || undefined));
    return;
  }
  if (command === 'dispatch-work') {
    const itemId = positionalArgs(args, ['--project', '--permission'])[0];
    if (!itemId) throw new Error('dispatch-work WORK_ITEM_ID is required');
    json(await client.dispatchWorkItem(itemId, {
      projectId: readFlag(args, '--project') || undefined,
      permissionProfile: readFlag(args, '--permission', 'write-proposed')
    }));
    return;
  }
  if (command === 'hook') {
    const title = readFlag(args, '--title') || positionalArgs(args, ['--source', '--event', '--type', '--title', '--body', '--priority', '--permission', '--project'])[0];
    if (!title) throw new Error('hook --title is required');
    json(await client.ingestEvent({
      projectId: readFlag(args, '--project') || undefined,
      source: readFlag(args, '--source', 'cli'),
      event: readFlag(args, '--event', 'developer.event'),
      type: readFlag(args, '--type', 'issue'),
      title,
      body: readFlag(args, '--body', ''),
      priority: readFlag(args, '--priority', 'medium'),
      dispatchToManager: hasFlag(args, '--dispatch'),
      permissionProfile: readFlag(args, '--permission', 'write-proposed')
    }));
    return;
  }
  if (command === 'validate') {
    const file = readFlag(args, '--file', 'at.team.json');
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
    const errors = validateManifest(manifest);
    const result = {
      ok: errors.length === 0,
      file,
      schema: resolve(appRoot, 'schemas/at-team.schema.json'),
      errors,
      summary: summarizeManifest(manifest, file)
    };
    json(result);
    if (errors.length) process.exit(1);
    return;
  }
  if (command === 'apply-manifest') {
    const file = readFlag(args, '--file', 'at.team.json');
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
    const errors = validateManifest(manifest);
    if (errors.length) {
      json({ ok: false, file, errors });
      process.exit(1);
    }
    if (hasFlag(args, '--dry-run')) {
      json(summarizeManifest(manifest, file));
      return;
    }
    json(await client.applyManifest(manifest, readFlag(args, '--project') || undefined));
    return;
  }
  if (command === 'watch') {
    const runId = positionalArgs(args, ['--after', '--max'])[0];
    if (!runId) throw new Error('watch RUN_ID is required');
    await watchRunEvents(client, runId, args);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
