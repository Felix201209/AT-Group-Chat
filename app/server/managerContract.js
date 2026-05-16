import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function buildManagerContract({
  apiBaseUrl = process.env.AT_TEAM_API_BASE_URL || 'http://127.0.0.1:5174'
} = {}) {
  const packageInfo = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8'));
  const promptPath = resolve(appRoot, 'templates/external-manager-prompt.md');
  const prompt = readFileSync(promptPath, 'utf8');
  return {
    ok: true,
    name: 'AT external manager contract',
    version: packageInfo.version,
    apiBaseUrl,
    mode: 'manager-controlled',
    rules: [
      'Create one chat task or one work item.',
      'Dispatch at most one role at a time unless the human explicitly asks for more.',
      'All agents can see the shared transcript, but only manager-triggered roles should reply.',
      'Do not create autonomous discussion loops.',
      'Stop after a terminal run event or after a written manager decision.'
    ],
    permissions: ['readonly', 'write-proposed', 'workspace-write', 'danger'],
    cli: {
      ask: 'at-group-chat ask "Act as manager: inspect this repo and create the next review item." --json',
      work: 'at-group-chat work --type review "Review title" --body "Review request" --dispatch',
      watch: 'at-group-chat watch <runId> --json',
      activity: 'at-group-chat activity <workItemId>',
      initAll: 'at-group-chat init --all'
    },
    http: {
      getContract: 'GET /api/contract',
      createTask: 'POST /api/chat/messages',
      createRun: 'POST /api/runs',
      dispatchRun: 'POST /api/runs/:id/dispatch',
      runEvents: 'GET /api/runs/:id/events',
      workItems: 'GET /api/work-items',
      dispatchWorkItem: 'POST /api/work-items/:id/dispatch',
      openapi: 'GET /api/openapi.json'
    },
    mcpTools: [
      'team_get_manager_contract',
      'team_create_task',
      'team_dispatch_agent',
      'team_get_status',
      'team_get_memory',
      'team_set_permission',
      'team_get_work_items',
      'team_create_work_item',
      'team_get_work_item_activity',
      'team_dispatch_work_item'
    ],
    files: {
      prompt: promptPath,
      sdk: resolve(appRoot, 'sdk/client.mjs'),
      openapi: resolve(appRoot, 'server/openapi.js'),
      schema: resolve(appRoot, 'schemas/at-team.schema.json')
    },
    prompt
  };
}

export function formatManagerContract(contract) {
  return [
    '# AT External Manager Contract',
    '',
    `API base URL: ${contract.apiBaseUrl}`,
    `Mode: ${contract.mode}`,
    '',
    '## Rules',
    ...contract.rules.map((rule) => `- ${rule}`),
    '',
    '## CLI',
    ...Object.entries(contract.cli).map(([name, command]) => `- ${name}: \`${command}\``),
    '',
    '## HTTP',
    ...Object.entries(contract.http).map(([name, endpoint]) => `- ${name}: \`${endpoint}\``),
    '',
    '## MCP',
    ...contract.mcpTools.map((tool) => `- ${tool}`),
    '',
    '## Prompt',
    contract.prompt.trimEnd()
  ].join('\n');
}
