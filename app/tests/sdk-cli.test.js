import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ATClient } from '../sdk/client.mjs';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

test('SDK and CLI expose programmer-facing AT entry points', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-sdk-cli-'));
  const port = 23000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AT_TEAM_DB_PATH: join(dir, 'sdk-cli.sqlite'),
      AT_TEAM_AGENT_MODE: 'mock',
      PORT: String(port),
      AT_TEAM_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl);
    const client = new ATClient({ baseUrl });
    const openapi = await client.openApi();
    assert.equal(openapi.info.version, '1.1.0');

    const chat = await client.chat({
      content: 'SDK smoke: manager should receive this.',
      permissionProfile: 'readonly'
    });
    assert.equal(chat.accepted, true);
    assert.match(chat.eventStream, /\/api\/runs\/.+\/events/);
    const eventIterator = client.runEvents(chat.run.id);
    const firstRunEvent = await eventIterator.next();
    await eventIterator.return?.();
    assert.equal(firstRunEvent.value.type, 'run.created');

    const issue = await client.createWorkItem({
      type: 'issue',
      title: 'SDK issue smoke',
      body: 'Created through SDK.',
      dispatchToManager: false
    });
    assert.equal(issue.workItem.type, 'issue');

    const hook = await client.ingestEvent({
      source: 'sdk',
      event: 'test.failed',
      title: 'SDK hook smoke',
      body: 'Created through SDK event ingestion.',
      metadata: { dedupeKey: 'sdk-hook-smoke-1' }
    });
    assert.equal(hook.metadata.source, 'sdk');
    const hookDuplicate = await client.ingestEvent({
      source: 'sdk',
      event: 'test.failed',
      title: 'SDK hook duplicate',
      metadata: { dedupeKey: 'sdk-hook-smoke-1' }
    });
    assert.equal(hookDuplicate.duplicate, true);

    const manifest = await client.applyManifest({
      name: 'SDK manifest smoke',
      defaults: {
        roleIds: ['kimi-ux-review'],
        thinkingLevel: 'high',
        defaultPermission: 'readonly'
      },
      agents: [{
        roleId: 'sdk-manifest-agent',
        adapter: 'generic-cli',
        command: 'zsh',
        commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
        model: 'local',
        responsibility: 'SDK manifest test agent.'
      }],
      workItems: [{
        type: 'proposal',
        title: 'SDK manifest proposal',
        body: 'Seeded from manifest.'
      }]
    });
    assert.equal(manifest.manifest.name, 'SDK manifest smoke');
    assert.ok(manifest.applied.agents.some((agent) => agent.role_id === 'sdk-manifest-agent'));
    const manifestAgain = await client.applyManifest({
      name: 'SDK manifest smoke',
      defaults: {
        roleIds: ['kimi-ux-review'],
        thinkingLevel: 'high',
        defaultPermission: 'readonly'
      },
      workItems: [{
        type: 'proposal',
        title: 'SDK manifest proposal',
        body: 'Updated from repeated manifest apply.'
      }]
    });
    assert.equal(manifestAgain.applied.workItems[0].manifestExisting, true);
    const workAfterManifest = await client.workItems();
    assert.equal(
      workAfterManifest.workItems.filter((item) => item.metadata?.manifestKey === 'SDK manifest smoke:1:proposal:SDK manifest proposal').length,
      1
    );

    const statusOutput = execFileSync('node', ['scripts/at.mjs', 'status'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const status = JSON.parse(statusOutput);
    assert.ok(status.agents.some((agent) => agent.id === 'codex-manager'));

    const openApiOutput = execFileSync('node', ['scripts/at.mjs', 'openapi'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(JSON.parse(openApiOutput).openapi, '3.1.0');
    const helpOutput = execFileSync('node', ['scripts/at.mjs', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.match(helpOutput, /at-group-chat serve/);
    assert.match(helpOutput, /at-group-chat ask/);
    assert.match(helpOutput, /at-group-chat token --env/);
    const versionOutput = execFileSync('node', ['scripts/at.mjs', '--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }).trim();
    assert.equal(versionOutput, 'at-group-chat@1.1.0');
    const versionJson = JSON.parse(execFileSync('node', ['scripts/at.mjs', 'version', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
    assert.equal(versionJson.version, '1.1.0');
    assert.equal(versionJson.openapiVersion, '1.1.0');
    const mcpConfigOutput = execFileSync('node', ['scripts/at.mjs', 'mcp-config'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl, AT_TEAM_API_TOKEN: 'test-admin-token' },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const mcpConfig = JSON.parse(mcpConfigOutput);
    assert.ok(mcpConfig.mcpServers['at-group-chat'].args.some((arg) => arg.endsWith('server/mcp.js')));
    assert.equal(mcpConfig.mcpServers['at-group-chat'].env.AT_TEAM_API_BASE_URL, baseUrl);
    assert.equal(mcpConfig.mcpServers['at-group-chat'].env.AT_TEAM_API_TOKEN, 'test-admin-token');
    const tokenOutput = execFileSync('node', ['scripts/at.mjs', 'token'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const token = JSON.parse(tokenOutput);
    assert.equal(token.ok, true);
    assert.match(token.env.AT_TEAM_API_TOKEN, /^[-_A-Za-z0-9]{32,}$/);
    assert.match(token.env.AT_TEAM_HOOK_TOKEN, /^[-_A-Za-z0-9]{32,}$/);
    const tokenEnvOutput = execFileSync('node', ['scripts/at.mjs', 'token', '--env'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.match(tokenEnvOutput, /^AT_TEAM_API_TOKEN=[-_A-Za-z0-9]{32,}$/m);
    assert.match(tokenEnvOutput, /^AT_TEAM_HOOK_TOKEN=[-_A-Za-z0-9]{32,}$/m);
    const envOutput = execFileSync('node', ['scripts/at.mjs', 'env'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.match(envOutput, /AT_TEAM_API_TOKEN=/);
    assert.match(envOutput, /CODEX_APP_SERVER_URL=/);
    const envJsonOutput = execFileSync('node', ['scripts/at.mjs', 'env', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const envJson = JSON.parse(envJsonOutput);
    assert.equal(envJson.ok, true);
    assert.equal(envJson.docsAvailable, true);
    assert.ok(envJson.variables.includes('AT_SETUP_SKIP_ON_INSTALL'));
    const pathsOutput = execFileSync('node', ['scripts/at.mjs', 'paths'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const paths = JSON.parse(pathsOutput);
    assert.equal(paths.ok, true);
    assert.ok(paths.files.sdk.endsWith('sdk/client.mjs'));
    assert.ok(paths.files.schema.endsWith('schemas/at-team.schema.json'));
    assert.match(paths.notes.join(' '), /at-group-chat openapi/);
    assert.ok(paths.docs.integrations.endsWith('docs/integrations.md'));
    assert.ok(paths.templates.githubActionsHook.endsWith('templates/github-actions-at-hook.yml'));
    assert.ok(paths.examples.externalManagerSdk.endsWith('examples/external-manager-sdk.mjs'));
    const managerTemplate = execFileSync('node', ['scripts/at.mjs', 'template', 'external-manager'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.match(managerTemplate, /Manager decision/);
    const templateJson = JSON.parse(execFileSync('node', ['scripts/at.mjs', 'template', 'team', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
    assert.equal(templateJson.ok, true);
    assert.equal(templateJson.name, 'team');
    assert.ok(templateJson.path.endsWith('at.team.example.json'));
    assert.match(templateJson.content, /AT release review team/);
    const recipeText = execFileSync('node', ['scripts/at.mjs', 'recipe', 'sdk'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.match(recipeText, /Use AT from a Node\.js tool/);
    const recipeJson = JSON.parse(execFileSync('node', ['scripts/at.mjs', 'recipe', 'github-actions', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }));
    assert.equal(recipeJson.ok, true);
    assert.equal(recipeJson.name, 'github-actions');
    assert.ok(recipeJson.commands.some((command) => command.includes('template github-actions')));

    const watchOutput = execFileSync('node', ['scripts/at.mjs', 'watch', chat.run.id, '--max', '1', '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }).trim();
    assert.equal(JSON.parse(watchOutput).type, 'run.created');

    const askOutput = execFileSync('node', ['scripts/at.mjs', 'ask', 'CLI ask smoke: create one manager-controlled run.', '--permission', 'readonly', '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(askOutput[0].type, 'chat.accepted');
    assert.ok(askOutput.some((event) => event.type === 'run.created'));
    assert.ok(askOutput.some((event) => event.type === 'agent.completed'));

    const hookOutput = execFileSync('node', ['scripts/at.mjs', 'hook', '--source', 'cli', '--event', 'lint.failed', '--title', 'CLI hook smoke'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(JSON.parse(hookOutput).metadata.event, 'lint.failed');

    const proposalOutput = execFileSync('node', ['scripts/at.mjs', 'proposal', 'CLI proposal smoke', '--body', 'Plan body'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(JSON.parse(proposalOutput).workItem.type, 'proposal');
    const genericWorkOutput = execFileSync('node', ['scripts/at.mjs', 'work', '--type', 'review', 'CLI review smoke', '--body', 'Review body'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(JSON.parse(genericWorkOutput).workItem.type, 'review');
    const itemsOutput = execFileSync('node', ['scripts/at.mjs', 'items'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.ok(JSON.parse(itemsOutput).workItems.some((item) => item.title === 'SDK issue smoke'));
    const activityOutput = execFileSync('node', ['scripts/at.mjs', 'activity', issue.workItem.id], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(JSON.parse(activityOutput).item.id, issue.workItem.id);
    const dispatchWorkOutput = execFileSync('node', ['scripts/at.mjs', 'dispatch-work', issue.workItem.id, '--permission', 'readonly'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.ok(JSON.parse(dispatchWorkOutput).run.id);
    assert.throws(() => execFileSync('node', ['scripts/at.mjs', 'work', '--type', 'invalid', 'Bad work type'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    }), (error) => {
      assert.match(error.stderr, /--type must be one of/);
      return true;
    });

    const positionalHookOutput = execFileSync('node', ['scripts/at.mjs', 'hook', '--source', 'ci', '--event', 'test.failed', 'Positional hook title'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(JSON.parse(positionalHookOutput).title, 'Positional hook title');

    const manifestPath = join(dir, 'at.team.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'CLI manifest smoke',
      agents: [{
        roleId: 'cli-manifest-agent',
        adapter: 'generic-cli',
        command: 'zsh',
        commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
        model: 'local',
        responsibility: 'CLI manifest test agent.'
      }]
    }));
    const dryRunOutput = execFileSync('node', ['scripts/at.mjs', 'apply-manifest', '--file', manifestPath, '--dry-run'], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1' },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const dryRun = JSON.parse(dryRunOutput);
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.changes.agents[0].roleId, 'cli-manifest-agent');
    const validateOutput = execFileSync('node', ['scripts/at.mjs', 'validate', '--file', manifestPath], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1' },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const validate = JSON.parse(validateOutput);
    assert.equal(validate.ok, true);
    assert.match(validate.schema, /schemas\/at-team\.schema\.json$/);
    const unsafeManifestPath = join(dir, 'unsafe.at.team.json');
    writeFileSync(unsafeManifestPath, JSON.stringify({
      agents: [{
        roleId: 'unsafe-cli-manifest-agent',
        adapter: 'generic-cli',
        command: 'zsh',
        commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE" | tee /tmp/at-unsafe'
      }]
    }));
    assert.throws(() => execFileSync('node', ['scripts/at.mjs', 'validate', '--file', unsafeManifestPath], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1' },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }), (error) => {
      assert.match(error.stdout, /dangerousCommandTemplate/);
      return true;
    });

    const manifestOutput = execFileSync('node', ['scripts/at.mjs', 'apply-manifest', '--file', manifestPath], {
      cwd: process.cwd(),
      env: { ...process.env, AT_TEAM_API_BASE_URL: baseUrl },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    assert.ok(JSON.parse(manifestOutput).applied.agents.some((agent) => agent.role_id === 'cli-manifest-agent'));

    const dryRunRepoDir = join(dir, 'dry-run-repo');
    const repoDir = join(dir, 'repo');
    mkdirSync(dryRunRepoDir, { recursive: true });
    const initDryRunOutput = execFileSync('node', [join(process.cwd(), 'scripts/at.mjs'), 'init', '--dry-run'], {
      cwd: dryRunRepoDir,
      env: { ...process.env, AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1' },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const initDryRun = JSON.parse(initDryRunOutput);
    assert.equal(initDryRun.dryRun, true);
    assert.ok(initDryRun.files.some((file) => file.target.endsWith('at.team.json')));
    assert.equal(existsSync(join(dryRunRepoDir, 'at.team.json')), false);

    mkdirSync(repoDir, { recursive: true });
    const initOutput = execFileSync('node', [join(process.cwd(), 'scripts/at.mjs'), 'init'], {
      cwd: repoDir,
      env: { ...process.env, AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1' },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    const init = JSON.parse(initOutput);
    assert.equal(init.ok, true);
    assert.ok(existsSync(join(repoDir, 'at.team.json')));
    assert.ok(existsSync(join(repoDir, '.github/workflows/at-hook.yml')));
    assert.ok(existsSync(join(repoDir, 'docs/at-external-manager.md')));
    assert.equal(
      readFileSync(join(repoDir, 'at.team.json'), 'utf8'),
      readFileSync(join(process.cwd(), 'at.team.example.json'), 'utf8')
    );
    assert.equal(
      readFileSync(join(repoDir, 'docs/at-external-manager.md'), 'utf8'),
      readFileSync(join(process.cwd(), 'templates/external-manager-prompt.md'), 'utf8')
    );
    assert.match(readFileSync(join(repoDir, '.github/workflows/at-hook.yml'), 'utf8'), /AT_TEAM_HOOK_TOKEN/);
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SDK preserves HTTP status when an upstream returns non-JSON text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    statusText: 'Bad Gateway',
    text: async () => '<html>bad gateway</html>'
  });

  try {
    const client = new ATClient({ baseUrl: 'http://at.invalid' });
    await assert.rejects(
      () => client.status(),
      (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.data.raw, '<html>bad gateway</html>');
        assert.match(error.message, /502 Bad Gateway/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('packaged developer examples are present and executable-looking', () => {
  const sdkExample = readFileSync('examples/external-manager-sdk.mjs', 'utf8');
  const hookExample = readFileSync('examples/ci-hook.sh', 'utf8');
  assert.match(sdkExample, /createATClient/);
  assert.match(sdkExample, /at\.chat/);
  assert.match(sdkExample, /runEvents/);
  assert.match(sdkExample, /chat\.accepted/);
  assert.match(hookExample, /AT_TEAM_HOOK_TOKEN/);
  assert.match(hookExample, /api\/hooks\/events/);
});
