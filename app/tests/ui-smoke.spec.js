import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DB_DIR = join(tmpdir(), `at-ui-smoke-${process.pid}`);
const DB_PATH = join(DB_DIR, 'at-team.sqlite');

let server;
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
  const port = await getFreePort();
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

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(Math.max(overflow.body, overflow.document)).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function expectVisibleFocus(locator) {
  const outline = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor
    };
  });
  expect(outline.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(outline.outlineWidth)).toBeGreaterThanOrEqual(2);
}

test('dashboard renders the manager-controlled team and exercises the primary flow', async ({ page }) => {
  test.setTimeout(70000);
  const consoleMessages = [];
  const workTitle = `UI smoke proposal work item ${Date.now()}`;
  const chatMessage = `UI smoke chat ${Date.now()}`;
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle(/AT Agent Team/);
  await expect(page.getByText('AT 群聊', { exact: true })).toBeVisible();
  await expect(page.getByText('AI Collaboration Room')).toBeVisible();
  await expect(page.locator('.group-chat').getByText('AT AI 合作群聊', { exact: true })).toBeVisible();
  await expect(page.getByText('不自由讨论 / 不自动循环')).toBeVisible();
  await expect(page.getByRole('button', { name: /Platform/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Chat/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'API', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Chat/ }).focus();
  await expect(page.getByRole('button', { name: /Chat/ })).toBeFocused();
  await expectVisibleFocus(page.getByRole('button', { name: /Chat/ }));

  await page.getByRole('button', { name: /Platform/ }).click();
  await expect(page.getByText('本地 Agent Runtime 控制平面')).toBeVisible();
  await expect(page.getByText('Setup Checklist')).toBeVisible();
  await expect(page.locator('.setup-item strong', { hasText: /^Codex server$/ })).toBeVisible();
  await expect(page.locator('.setup-item strong', { hasText: /^API token$/ })).toBeVisible();
  await expect(page.locator('.setup-item strong', { hasText: /^Agent mode$/ })).toBeVisible();
  await expect(page.getByText('completion gate')).toBeVisible();
  await expect(page.getByText(/now .*Asia\/Shanghai.*final audit after 2026-05-13 07:30 CST/)).toBeVisible();
  const exportLink = page.getByRole('link', { name: 'Export portable state' });
  await expect(exportLink).toBeVisible();
  await expect(exportLink).toHaveAttribute('href', '/api/platform/export');
  await expect(exportLink).toHaveAttribute('download', 'at-platform-export.json');
  await expect(page.getByText('Adapter Registry', { exact: true })).toBeVisible();
  await expect(page.getByText('Generic Local CLI')).toBeVisible();

  await page.getByRole('button', { name: 'API', exact: true }).click();
  await expect(page.getByText('入口 1')).toBeVisible();
  await expect(page.getByText('上方聊天框')).toBeVisible();
  await expect(page.getByText('入口 2')).toBeVisible();
  await expect(page.getByText('外部 agent 调 API 当 manager')).toBeVisible();
  await expect(page.getByText('POST /api/chat/messages  # AT AI 合作群聊入口')).toBeVisible();
  await expect(page.getByText(/team_chat_message/)).toBeVisible();
  await expect(page.getByText('Codex App Server')).toBeVisible();
  await expect(page.getByText(/单点调度/)).toBeVisible();
  await expect(page.getByText(/不自动循环/)).toBeVisible();

  await page.getByRole('button', { name: /Work/ }).click();
  await expect(page.getByText('AT 协作对象板')).toBeVisible();
  await expect(page.locator('.work-column-head strong', { hasText: /^Proposal \/ PR$/ })).toBeVisible();
  await page.getByLabel('work item type').selectOption('proposal');
  await page.getByLabel('work item title').fill(workTitle);
  await page.getByLabel('work item priority').selectOption('high');
  await page.getByLabel('work item assignee').selectOption('kimi-ux-review');
  await page.getByLabel('work item body').fill('验证 AT 不只是聊天室，而是有 proposal/review/decision 对象。');
  await page.getByLabel('创建后交给 Manager').uncheck();
  const [workCreateResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/work-items') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '创建 Work Item' }).click()
  ]);
  expect(workCreateResponse.ok()).toBeTruthy();
  await expect(page.getByRole('status')).toContainText('Proposal / PR 已创建');
  await expect(page.getByText(workTitle)).toBeVisible();
  const workCard = page.locator('.work-card').filter({ hasText: workTitle });
  await expect(workCard.locator('span', { hasText: 'User Interaction + UI/UX Review' })).toBeVisible();
  await workCard.getByRole('button', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/#work\/.+/);
  await expect(page.getByText('Related Items')).toBeVisible();
  await expect(page.getByText('Messages')).toBeVisible();
  await expect(page.getByText('Events')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#work$/);
  await workCard.getByRole('button', { name: '生成 Review' }).click();
  await expect(page.getByRole('status')).toContainText('review request');

  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.getByText('Customize AT Team')).toBeVisible();
  await expect(page.getByText('Security / Operations')).toBeVisible();
  await expect(page.getByText('API Token')).toBeVisible();
  await expect(page.getByText('Data Path')).toBeVisible();
  await expect(page.getByText('Export audit snapshot')).toBeVisible();
  await expect(page.getByText('Agent / Model / Thinking 配置')).toBeVisible();
  await expect(page.getByText('Date / Time Skill')).toBeVisible();
  await expect(page.getByText('Team Defaults')).toBeVisible();
  await expect(page.getByText('Generic CLI Env')).toBeVisible();
  await expect(page.getByText('AT_AGENT_PROMPT_FILE')).toBeVisible();
  await expect(page.getByText('AT_AGENT_THINKING_LEVEL')).toBeVisible();
  await expect(page.getByRole('button', { name: '应用到全队' })).toBeDisabled();
  await page.getByLabel('team default thinking level').selectOption('low');
  await expect(page.getByRole('button', { name: '应用到全队' })).toBeEnabled();
  await expect(page.getByLabel('codex-manager thinking level')).toBeVisible();
  await expect(page.getByLabel('codex-manager responsibility')).toBeVisible();

  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.getByText('自由讨论 / 无限循环: 关')).toBeVisible();

  const lanes = page.locator('.agent-lane');
  await expect(lanes).toHaveCount(4);
  await expect(page.locator('.lane-head span', { hasText: /^codex-manager$/ })).toBeVisible();
  await expect(page.locator('.lane-head span', { hasText: /^codex-goal-review$/ })).toBeVisible();

  const sessionIds = await page.locator('.session-box code').allTextContents();
  expect(sessionIds[0]).not.toEqual(sessionIds[3]);

  const kimiLane = page.locator('.agent-lane').filter({ hasText: 'kimi-ux-review' });
  await kimiLane.click();
  await expect(kimiLane.getByRole('button', { name: /Manager 点名此岗位/ })).toBeVisible();
  await page.getByRole('button', { name: /Chat/ }).click();
  await expect(page.getByRole('button', { name: /发送/ })).toBeVisible({ timeout: 10000 });
  const systemToggle = page.getByLabel('starter tasks');
  if (await systemToggle.count()) {
    await expect(page.getByRole('button', { name: '审查当前项目' })).toBeVisible();
  }
  const composer = page.locator('.chat-composer textarea');
  await expect(composer).toBeVisible();
  await composer.focus();
  await expect(composer).toBeFocused();
  await expectVisibleFocus(composer);
  await composer.fill(chatMessage);
  await composer.press('Shift+Enter');
  await composer.type('第二行');
  await expect(composer).toHaveValue(`${chatMessage}\n第二行`);
  const [chatResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/chat/messages') && response.request().method() === 'POST'),
    page.getByRole('button', { name: /发送/ }).click()
  ]);
  expect(chatResponse.ok()).toBeTruthy();
  await expect(page.locator('.chat-message.user').filter({ hasText: chatMessage }).last()).toBeVisible();

  const streamBox = await page.locator('.chat-stream').boundingBox();
  const latestUserBox = await page.locator('.chat-message.user').last().boundingBox();
  expect(streamBox).not.toBeNull();
  expect(latestUserBox).not.toBeNull();
  expect(latestUserBox.x + latestUserBox.width / 2).toBeGreaterThan(streamBox.x + streamBox.width / 2);
  const streamScroll = await page.locator('.chat-stream').evaluate((element) => ({
    top: element.scrollTop,
    max: element.scrollHeight - element.clientHeight
  }));
  expect(Math.abs(streamScroll.max - streamScroll.top)).toBeLessThanOrEqual(2);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('AT AI 合作群聊')).toBeVisible();
  await expect(page.locator('.roster-chip').filter({ hasText: 'Team Manager' })).toBeVisible();
  const mobileUser = page.locator('.chat-message.user').last();
  const mobileUserBox = await mobileUser.boundingBox();
  const mobileUserAvatarBox = await mobileUser.locator('.chat-avatar').boundingBox();
  const mobileUserBubbleBox = await mobileUser.locator('.message-stack p').boundingBox();
  expect(mobileUserBox).not.toBeNull();
  expect(mobileUserAvatarBox).not.toBeNull();
  expect(mobileUserBubbleBox).not.toBeNull();
  expect(mobileUserAvatarBox.x).toBeGreaterThan(mobileUserBubbleBox.x + mobileUserBubbleBox.width);
  expect(mobileUserBubbleBox.x + mobileUserBubbleBox.width).toBeGreaterThan(mobileUserBox.x + mobileUserBox.width / 2);
  const lastMobileNav = await page.locator('.nav-item').last().boundingBox();
  expect(lastMobileNav).not.toBeNull();
  expect(lastMobileNav.x + lastMobileNav.width).toBeLessThanOrEqual(390);
  for (const quickButton of await page.locator('.mention-bar button').all()) {
    const box = await quickButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await expectNoHorizontalOverflow(page);

  expect(consoleMessages.filter((item) => !item.includes('favicon')).join('\n')).toEqual('');
  await page.screenshot({ path: '/tmp/at-agent-team-dashboard.png', fullPage: true });
});
