import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DB_DIR = join(tmpdir(), `at-ui-customize-${process.pid}`);
const DB_PATH = join(DB_DIR, 'at-team.sqlite');

let server;
let port;
let baseUrl;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForStatus(timeoutMs = 30000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${baseUrl}/api/status`, { signal: controller.signal });
      if (response.ok) return response;
      lastError = `status ${response.status}`;
      await response.text().catch(() => '');
    } catch {
      lastError = 'fetch failed or timed out';
      // Keep polling until the isolated test server is ready.
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/status (${lastError})`);
}

test.beforeAll(async () => {
  test.setTimeout(60000);
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn('node', ['server/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      AT_TEAM_PORT: String(port),
      AT_TEAM_DB_PATH: DB_PATH,
      AT_TEAM_AGENT_MODE: 'mock',
      AT_TEAM_API_TOKEN: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await waitForStatus();
});

test.afterAll(() => {
  if (server) server.kill('SIGTERM');
  rmSync(DB_DIR, { recursive: true, force: true });
});

test('settings customization creates an agent and applies team defaults in an isolated room', async ({ page }) => {
  test.setTimeout(70000);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Settings/ }).click();

  await page.getByLabel('new agent role id').fill('Bad Role');
  await page.getByLabel('new agent name').fill('Invalid Agent');
  await page.getByRole('button', { name: '新增 Agent' }).click();
  await expect(page.getByRole('alert')).toContainText('roleId must be 2-63 chars');
  await expect(page.getByLabel('new agent role id')).toHaveValue('Bad Role');

  await page.getByLabel('new agent role id').fill('qwen-architect-ui-smoke');
  await page.getByLabel('new agent name').fill('Qwen Architect');
  await page.getByLabel('new agent model').fill('qwen3-coder');
  await page.getByLabel('new agent thinking level').selectOption('high');
  await page.getByLabel('new agent responsibility').fill('负责架构取舍和接口设计审查。');
  await page.getByLabel('new agent command template').fill('printf "qwen architect ok"');
  const [createAgentResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/agents') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '新增 Agent' }).click()
  ]);
  expect(createAgentResponse.ok()).toBeTruthy();

  await expect(page.getByRole('status')).toContainText('qwen-architect-ui-smoke 已加入 AT');
  await expect(page.getByLabel('qwen-architect-ui-smoke model')).toHaveValue('qwen3-coder');
  await expect(page.getByLabel('qwen-architect-ui-smoke thinking level')).toHaveValue('high');
  await expect(page.getByLabel('qwen-architect-ui-smoke responsibility')).toHaveValue('负责架构取舍和接口设计审查。');

  await page.getByLabel('team default model').fill('team-model-ui-smoke');
  await page.getByLabel('team default thinking level').selectOption('xhigh');
  await page.getByLabel('team default permission').selectOption('write-proposed');
  const [teamConfigResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/team/config') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '应用到全队' }).click()
  ]);
  expect(teamConfigResponse.ok()).toBeTruthy();
  const teamConfigBody = await teamConfigResponse.json();
  expect(teamConfigBody.result.config).toMatchObject({
    model: 'team-model-ui-smoke',
    thinkingLevel: 'xhigh',
    defaultPermission: 'write-proposed'
  });
  await expect(page.getByRole('status')).toContainText('Team Defaults 已应用到启用的 agent');

  await expect(page.getByLabel('qwen-architect-ui-smoke model')).toHaveValue('team-model-ui-smoke');
  await expect(page.getByLabel('qwen-architect-ui-smoke thinking level')).toHaveValue('xhigh');
  await expect(page.getByLabel('qwen-architect-ui-smoke default permission')).toHaveValue('write-proposed');

  await page.getByLabel('qwen-architect-ui-smoke name').fill('Qwen Architect Lead');
  const qwenRow = page.locator('.agent-config-row').filter({ hasText: 'qwen-architect-ui-smoke' });
  const [agentConfigResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/agents/qwen-architect-ui-smoke/config') && response.request().method() === 'POST'),
    qwenRow.getByRole('button', { name: '保存' }).click()
  ]);
  expect(agentConfigResponse.ok()).toBeTruthy();
  await expect(page.getByRole('status')).toContainText('qwen-architect-ui-smoke 配置已保存');
  await expect(page.getByLabel('qwen-architect-ui-smoke name')).toHaveValue('Qwen Architect Lead');

  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.locator('.agent-lane')).toHaveCount(5);
  await expect(page.locator('.lane-head span', { hasText: /^qwen-architect-ui-smoke$/ })).toBeVisible();
  await expect(page.getByText('自由讨论 / 无限循环: 关')).toBeVisible();
});
