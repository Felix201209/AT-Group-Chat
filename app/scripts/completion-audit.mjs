import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const CUTOFF = Date.parse('2026-05-17T07:30:00+08:00');
const requireCutoff = process.argv.includes('--require-cutoff');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasText(path, text) {
  return existsSync(path) && readFileSync(path, 'utf8').includes(text);
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function markdownFencesBalanced(path) {
  const fences = readText(path).match(/```/g) || [];
  return fences.length > 0 && fences.length % 2 === 0;
}

function localTime() {
  return execFileSync('date', ['+%Y-%m-%d %H:%M:%S %Z (%z)'], { encoding: 'utf8' }).trim();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function item(id, label, ok, evidence) {
  return { id, label, ok: Boolean(ok), evidence };
}

const pkg = readJson('package.json');
const now = Date.now();
const dateTimeSkillPath = '/Users/felix/.codex/skills/date-time-check/SKILL.md';
const checks = [
  item(
    'date-time-skill',
    'date/time check skill is installed, documented, and contains local clock/cutoff rules',
    existsSync(dateTimeSkillPath) &&
      hasText('README.md', dateTimeSkillPath) &&
      hasText(dateTimeSkillPath, "date '+%Y-%m-%d %H:%M:%S %Z (%z)'") &&
      hasText(dateTimeSkillPath, 'date -u') &&
      hasText(dateTimeSkillPath, 'TZ=Asia/Shanghai') &&
      hasText(dateTimeSkillPath, 'compare the requested cutoff') &&
      hasText(dateTimeSkillPath, 'do not wait or sleep just to cross the cutoff'),
    `${dateTimeSkillPath} + README.md`
  ),
  item(
    'manager-skill',
    'AT manager skill is installed and mirrored in project docs',
    existsSync('/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md') &&
      existsSync('docs/agent-manager-skill.md') &&
      hasText('/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md', 'team_export_platform') &&
      hasText('/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md', 'AT_AGENT_NAME') &&
      hasText('/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md', 'at-group-chat token --env') &&
      hasText('/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md', 'at-group-chat work --type review') &&
      hasText('docs/agent-manager-skill.md', 'team_export_platform') &&
      hasText('docs/agent-manager-skill.md', 'AT_AGENT_NAME') &&
      hasText('docs/agent-manager-skill.md', 'at-group-chat token --env') &&
      hasText('docs/agent-manager-skill.md', 'at-group-chat work --type review'),
    '/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md + docs/agent-manager-skill.md'
  ),
  item(
    'documentation-integrity',
    'README and operational docs keep balanced Markdown code fences and core run/audit instructions',
    ['README.md', 'docs/agent-manager-skill.md', 'docs/completion-audit.md'].every(markdownFencesBalanced) &&
      hasText('README.md', 'npm run verify') &&
      hasText('README.md', 'npm run verify:complete') &&
      hasText('README.md', 'file://.../index.html') &&
      hasText('docs/completion-audit.md', '2026-05-17 07:30:00 CST') &&
      hasText('docs/agent-manager-skill.md', 'manager-controlled 模式'),
    'README.md + docs/agent-manager-skill.md + docs/completion-audit.md'
  ),
  item(
    'delivery-hygiene',
    'generated dependencies, build output, persistent data, and Playwright artifacts are ignored',
    hasText('.gitignore', 'node_modules/') &&
      hasText('.gitignore', 'dist/') &&
      hasText('.gitignore', 'data/') &&
      hasText('.gitignore', 'test-results/'),
    '.gitignore'
  ),
  item(
    'verification-scripts',
    'verification gates are exposed as npm scripts',
    ['health', 'preflight', 'test', 'test:ui', 'test:browser', 'build', 'typecheck', 'audit', 'audit:complete', 'smoke:manager', 'verify', 'verify:complete'].every((name) => pkg.scripts?.[name]) &&
      pkg.scripts?.['verify:complete']?.startsWith('npm run audit:complete') &&
      pkg.scripts?.verify?.includes('npm run typecheck') &&
      pkg.scripts?.['release:readiness']?.includes('scripts/release-readiness.mjs') &&
      pkg.scripts?.['release:dry-run']?.includes('npm run typecheck') &&
      pkg.scripts?.['release:dry-run']?.includes('npm test') &&
      pkg.scripts?.['release:dry-run']?.includes('npm run release:readiness') &&
      pkg.scripts?.['release:dry-run']?.includes('npm run package:smoke') &&
      pkg.scripts?.['release:dry-run']?.includes('npm publish --dry-run --json') &&
      pkg.scripts?.['package:smoke']?.includes('scripts/package-smoke.mjs') &&
      pkg.scripts?.['test:browser']?.includes('tests/ui-customize.spec.js') &&
      existsSync('docs/completion-audit.md'),
    Object.keys(pkg.scripts || {}).filter((name) => ['health', 'preflight', 'test', 'test:ui', 'test:browser', 'build', 'typecheck', 'audit', 'audit:complete', 'smoke:manager', 'verify', 'verify:complete'].includes(name))
  ),
  item(
    'group-chat-ui',
    'group-chat UI and manager-controlled loop policy are present',
    hasText('src/main.jsx', 'AT AI 合作群聊') &&
      hasText('src/main.jsx', 'Manager 控制') &&
      hasText('src/main.jsx', '不自动循环') &&
      hasText('src/main.jsx', 'completion gate') &&
      hasText('src/main.jsx', '2026-05-17 07:30 CST') &&
      hasText('src/uiFormatters.js', "timeZone: 'Asia/Shanghai'") &&
      hasText('src/main.jsx', 'Asia/Shanghai') &&
      hasText('src/main.jsx', 'setInterval(() => setNow(new Date()), 1000)'),
    'src/main.jsx + src/uiFormatters.js'
  ),
  item(
    'customize-ui',
    'settings expose model, thinking level, permissions, adapters, Generic CLI env, portable export, team defaults, and operation feedback',
    hasText('src/main.jsx', 'Customize AT Team') &&
      hasText('src/main.jsx', 'Team Defaults') &&
      hasText('src/main.jsx', 'Export portable state') &&
      hasText('src/main.jsx', 'Setup Checklist') &&
      hasText('src/main.jsx', 'Security / Operations') &&
      hasText('src/main.jsx', 'at-platform-export.json') &&
      hasText('src/main.jsx', 'Thinking') &&
      hasText('src/main.jsx', 'command template') &&
      hasText('src/main.jsx', 'Generic CLI Env') &&
      hasText('src/main.jsx', 'AT_AGENT_PROMPT_FILE') &&
      hasText('src/main.jsx', 'AT_AGENT_THINKING_LEVEL') &&
      hasText('src/main.jsx', 'role="status"') &&
      hasText('src/main.jsx', 'role="alert"') &&
      hasText('src/main.jsx', '配置已保存') &&
      hasText('src/main.jsx', 'showNotice(`${roleId} 配置已保存。`);\n      await refresh();') &&
      hasText('src/main.jsx', "showNotice('Team Defaults 已应用到启用的 agent。');\n      await refresh();"),
    'src/main.jsx'
  ),
  item(
    'work-items-platform',
    'AT exposes GitHub-like work items for issues, proposals, reviews, decisions, artifacts across UI, HTTP, MCP, transcript, export, and tests',
    hasText('README.md', 'issue`、`proposal/PR`、`review`、`decision`、`artifact') &&
      hasText('README.md', 'GET  /api/work-items') &&
      hasText('docs/agent-manager-skill.md', 'team_create_work_item') &&
      hasText('src/main.jsx', 'AT 协作对象板') &&
      hasText('src/main.jsx', 'WorkItemActivityPanel') &&
      hasText('src/main.jsx', '生成 Review Request') &&
      hasText('src/main.jsx', 'Proposal / PR') &&
      hasText('src/main.jsx', '创建 Work Item') &&
      hasText('server/storage.js', 'CREATE TABLE IF NOT EXISTS work_items') &&
      hasText('server/runtime.js', 'WORK ITEMS（issue/proposal/review/decision/artifact') &&
      hasText('server/runtime.js', 'work.item.linked_run') &&
      hasText('server/http.js', '/api/work-items') &&
      hasText('server/runtime.js', 'getWorkItemActivity') &&
      hasText('server/runtime.js', 'dispatchWorkItem') &&
      hasText('server/mcp.js', 'team_get_work_items') &&
      hasText('server/mcp.js', 'team_create_work_item') &&
      hasText('server/mcp.js', 'team_update_work_item') &&
      hasText('server/mcp.js', 'team_get_work_item_activity') &&
      hasText('server/mcp.js', 'team_dispatch_work_item') &&
      hasText('tests/runtime.test.js', 'work items model issues, proposals, reviews, decisions, and manager-linked runs') &&
      hasText('tests/http-sse.test.js', '/api/work-items') &&
      hasText('tests/mcp.test.js', 'team_create_work_item') &&
      hasText('tests/ui-smoke.spec.js', 'UI smoke proposal work item'),
    'README.md + docs/agent-manager-skill.md + src/main.jsx + server/* + tests/*'
  ),
  item(
    'manager-controlled-tests',
    'tests cover manager-controlled dispatch, split Codex sessions, UI, and browser smoke',
    hasText('tests/runtime.test.js', 'does not auto-trigger another agent') &&
      hasText('tests/runtime.test.js', 'Codex manager and Codex goal reviewer use different') &&
      hasText('tests/ui-smoke.spec.js', 'dashboard renders the manager-controlled team'),
    'tests/runtime.test.js + tests/ui-smoke.spec.js'
  ),
  item(
    'chat-ux-regression-tests',
    'browser tests cover multiline composer, visible keyboard focus, latest-message autoscroll, right-aligned user messages on desktop and mobile, mobile nav/quick mention fit, and no horizontal overflow',
    hasText('tests/ui-smoke.spec.js', "'.chat-composer textarea'") &&
      hasText('tests/ui-smoke.spec.js', 'expectVisibleFocus') &&
      hasText('tests/ui-smoke.spec.js', 'streamScroll') &&
      hasText('tests/ui-smoke.spec.js', 'Shift+Enter') &&
      hasText('tests/ui-smoke.spec.js', '.chat-message.user') &&
      hasText('tests/ui-smoke.spec.js', 'mobileUserAvatarBox.x') &&
      hasText('tests/ui-smoke.spec.js', 'lastMobileNav') &&
      hasText('tests/ui-smoke.spec.js', '.mention-bar button') &&
      hasText('tests/ui-smoke.spec.js', 'expectNoHorizontalOverflow'),
    'tests/ui-smoke.spec.js'
  ),
  item(
    'http-mcp-surface',
    'HTTP and MCP surfaces expose the shared AT runtime controls',
    [
      'POST /api/chat/messages',
      'Export portable state',
      'content-disposition: attachment; filename="at-platform-export.json"',
      'AT_AGENT_NAME',
      'POST /api/team/config',
      'GET  /api/runs/:id/events',
      'GET  /api/work-items/:id/activity',
      'POST /api/work-items/:id/dispatch',
      'team_chat_message',
      'team_get_room',
      'team_get_work_item_activity',
      'team_dispatch_work_item',
      'team_dispatch_agent',
      'team_export_platform',
      'team_configure_agent',
      'team_configure_defaults'
    ].every((text) => hasText('README.md', text) || hasText('server/mcp.js', text)) &&
      hasText('server/mcp.js', 'runtime.postChatMessage') &&
      hasText('server/mcp.js', 'runtime.updateTeamConfig'),
    'README.md + server/mcp.js'
  ),
  item(
    'no-codex-exec-runtime',
    'runtime Codex roles use app-server instead of codex exec',
    hasText('server/adapters.js', 'Codex roles use codex app-server') &&
      hasText('server/codexAppServerClient.js', 'codex app-server') &&
      !hasText('server/codexAppServerClient.js', 'codex exec') &&
      hasText('tests/runtime.test.js', 'Codex roles do not build codex exec commands'),
    'server/adapters.js + server/codexAppServerClient.js + tests/runtime.test.js'
  ),
  item(
    'manager-smoke-script',
    'real manager smoke script verifies chat API to codex app-server manager path',
    existsSync('scripts/manager-smoke.mjs') &&
      hasText('scripts/manager-smoke.mjs', '/api/chat/messages') &&
      hasText('scripts/manager-smoke.mjs', 'codex app-server') &&
      hasText('docs/completion-audit.md', 'intentionally creates one readonly run/message') &&
      hasText('README.md', 'npm run smoke:manager'),
    'scripts/manager-smoke.mjs + README.md'
  ),
  item(
    'memory-isolation-tests',
    'project and role memory isolation is implemented and tested',
    hasText('server/storage.js', 'native_session_id TEXT NOT NULL') &&
      hasText('server/storage.js', 'UNIQUE(project_id, role_id)') &&
      hasText('server/runtime.js', 'storage.ensureSession({ projectId: project.id, role })') &&
      hasText('tests/runtime.test.js', 'project switching creates separate role memories') &&
      hasText('tests/runtime.test.js', 'Codex manager and Codex goal reviewer use different project-role sessions'),
    'server/storage.js + server/runtime.js + tests/runtime.test.js'
  ),
  item(
    'customize-runtime-tests',
    'custom roles, model, thinking level, permissions, adapters, team defaults, and Settings UI interactions are implemented and tested',
    hasText('server/storage.js', 'thinking_level') &&
      hasText('server/adapters.js', 'AT_AGENT_THINKING_LEVEL') &&
      hasText('tests/runtime.test.js', 'agent config updates persist model, adapter, command, and template') &&
      hasText('tests/runtime.test.js', 'team defaults update model, thinking level, and default permission') &&
      hasText('tests/mcp.test.js', 'team_configure_defaults') &&
      hasText('tests/mcp.test.js', 'team_export_platform') &&
      hasText('tests/ui-customize.spec.js', 'settings customization creates an agent') &&
      hasText('tests/ui-customize.spec.js', 'AT_TEAM_DB_PATH') &&
      hasText('tests/ui-customize.spec.js', 'rmSync(DB_DIR, { recursive: true, force: true })') &&
      hasText('tests/ui-customize.spec.js', "response.url().endsWith('/api/agents')") &&
      hasText('tests/ui-customize.spec.js', "getByRole('status')") &&
      hasText('tests/ui-customize.spec.js', "getByRole('alert')") &&
      hasText('tests/ui-customize.spec.js', 'Bad Role'),
    'server/storage.js + server/adapters.js + tests/runtime.test.js + tests/mcp.test.js + tests/ui-customize.spec.js'
  ),
  item(
    'static-file-boundary',
    'HTTP static serving is constrained to dist, platform export is a JSON attachment, and client validation errors return 400 without stack traces',
      hasText('server/http.js', 'PUBLIC_ROOT') &&
      hasText('server/http.js', 'filePath.startsWith') &&
      hasText('server/http.js', 'content-disposition') &&
      hasText('server/http.js', 'at-platform-export.json') &&
      hasText('server/http.js', 'isClientError') &&
      hasText('server/http.js', 'status === 500') &&
      hasText('tests/http-sse.test.js', '../../package.json') &&
      hasText('tests/http-sse.test.js', 'content-disposition') &&
      hasText('tests/http-sse.test.js', 'invalidAgent.status, 400') &&
      hasText('tests/http-sse.test.js', 'traversalText.includes'),
    'server/http.js + tests/http-sse.test.js'
  ),
  item(
    'code-review-hardening',
    'review hardening covers API client config/retry, optional token auth, CORS/body/rate limits, sanitized errors, SSE reconnect, dispatch dedupe, explicit mock mode, timer refs, focused memory refresh, and dev dependency hygiene',
    existsSync('src/apiClient.js') &&
      hasText('src/apiClient.js', 'VITE_AT_TEAM_API_BASE_URL') &&
      hasText('src/apiClient.js', 'VITE_AT_TEAM_API_TOKEN') &&
      hasText('src/apiClient.js', 'maxAttempts') &&
      hasText('src/apiClient.js', 'attempt <= maxAttempts') &&
      hasText('tests/api-client.test.js', 'retries transient fetch failures before succeeding') &&
      hasText('src/apiClient.js', 'x-at-token') &&
      hasText('src/apiClient.js', 'encodeURIComponent(token)') &&
      hasText('src/main.jsx', 'eventStreamUrl(`/api/runs/${activeRunId}/events`)') &&
      hasText('src/main.jsx', 'noticeTimerRef') &&
      hasText('src/main.jsx', 'useCallback(async') &&
      hasText('src/main.jsx', 'selectedSessionUpdated') &&
      hasText('src/main.jsx', 'connectionState') &&
      hasText('src/main.jsx', 'reconnecting') &&
      hasText('src/uiLabels.js', '极高') &&
      hasText('src/ErrorBoundary.jsx', 'getDerivedStateFromError') &&
      hasText('server/http.js', 'AT_TEAM_API_TOKEN') &&
      hasText('server/http.js', 'AT_TEAM_MAX_BODY_BYTES') &&
      hasText('server/http.js', 'MAX_TEXT_FIELD_LENGTH') &&
      hasText('server/http.js', 'content-security-policy') &&
      hasText('server/http.js', 'pruneRateLimit') &&
      hasText('server/http.js', 'rateLimitPruneTimer') &&
      hasText('server/http.js', 'apiRoutes') &&
      hasText('server/http.js', 'matchRoute') &&
      hasText('server/http.js', 'heartbeat') &&
      hasText('server/http.js', 'AT_TEAM_RATE_LIMIT_MAX') &&
      hasText('server/http.js', 'AT_TEAM_CORS_ORIGIN') &&
      hasText('server/http.js', "error: status === 500 ? 'Internal server error'") &&
      hasText('server/http.js', "'access-control-allow-origin': CORS_ORIGIN") &&
      hasText('server/runtime.js', 'const activeRuns = new Map()') &&
      hasText('server/runtime.js', 'duplicate: true') &&
      hasText('server/runtime.js', 'resolvedAgentMode') &&
      hasText('server/adapters.js', "mode = 'real'") &&
      hasText('tests/runtime.test.js', 'queued dispatch deduplicates active run-role work') &&
      hasText('tests/runtime.test.js', 'invokeAgent only uses mock mode when explicitly passed by runtime') &&
      hasText('tests/runtime.test.js', 'chat room tolerates corrupted JSON metadata fields') &&
      hasText('tests/http-sse.test.js', 'optional token auth, body limits, and sanitized server errors') &&
      pkg.devDependencies?.vite &&
      pkg.devDependencies?.typescript &&
      !pkg.dependencies?.vite &&
      !pkg.dependencies?.typescript,
    'src/apiClient.js + src/main.jsx + server/http.js + server/runtime.js + server/adapters.js + tests/* + package.json'
  ),
  item(
    'sqlite-storage-driver',
    'storage uses better-sqlite3 prepared statements instead of sqlite3 CLI subprocesses',
    pkg.dependencies?.['better-sqlite3'] &&
      hasText('server/storage.js', "import Database from 'better-sqlite3'") &&
      hasText('server/storage.js', 'statementCache') &&
      hasText('server/storage.js', 'MAX_CACHED_STATEMENTS') &&
      hasText('server/storage.js', "db.prepare(sql)") &&
      hasText('server/storage.js', "db.pragma('journal_mode = WAL')") &&
      hasText('server/storage.js', 'SCHEMA_VERSION') &&
      hasText('server/storage.js', 'user_version') &&
      hasText('server/storage.js', 'appendEventLog') &&
      !hasText('server/storage.js', "execFileSync('sqlite3'") &&
      !hasText('server/storage.js', 'quoteSql'),
    'package.json + server/storage.js'
  ),
  item(
    'developer-surface',
    'developer onboarding surface covers CLI init, SDK types, OpenAPI, webhook token, Team as Code, templates, examples, and package inclusion',
    pkg.files?.includes('sdk') &&
      pkg.files?.includes('schemas') &&
      pkg.files?.includes('templates') &&
      pkg.files?.includes('examples') &&
      pkg.exports?.['.']?.types === './sdk/client.d.ts' &&
      pkg.exports?.['.']?.import === './sdk/client.mjs' &&
      pkg.exports?.['./sdk']?.types === './sdk/client.d.ts' &&
      hasText('scripts/at.mjs', 'at-group-chat init --github --manager-prompt') &&
      hasText('scripts/at.mjs', 'at-group-chat init --all') &&
      hasText('scripts/at.mjs', 'at-group-chat contract --json') &&
      hasText('scripts/at.mjs', 'managerContract') &&
      hasText('scripts/at.mjs', 'generated:mcp-config') &&
      hasText('scripts/at.mjs', 'generated:openapi') &&
      hasText('scripts/at.mjs', 'at-group-chat serve') &&
      hasText('scripts/at.mjs', 'at-group-chat doctor --json') &&
      hasText('scripts/at.mjs', 'at-group-chat ask "Ask manager') &&
      hasText('scripts/at.mjs', 'watchRunEvents') &&
      hasText('scripts/at.mjs', 'watched.failed') &&
      hasText('scripts/at.mjs', 'chat task was accepted but no run id was returned') &&
      hasText('scripts/at.mjs', 'max events reached') &&
      hasText('scripts/at.mjs', 'at-group-chat --version') &&
      hasText('scripts/at.mjs', 'packageInfo') &&
      hasText('scripts/at.mjs', 'at-group-chat token --env') &&
      hasText('scripts/at.mjs', 'at-group-chat proposal "Title"') &&
      hasText('scripts/at.mjs', 'at-group-chat work --type review') &&
      hasText('scripts/at.mjs', 'at-group-chat items') &&
      hasText('scripts/at.mjs', 'at-group-chat activity WORK_ITEM_ID') &&
      hasText('scripts/at.mjs', 'at-group-chat dispatch-work WORK_ITEM_ID') &&
      hasText('scripts/at.mjs', 'at-group-chat completion zsh') &&
      hasText('scripts/at.mjs', 'completionContent') &&
      hasText('scripts/at.mjs', 'createWorkItemFromCli') &&
      hasText('scripts/at.mjs', 'randomBytes(32)') &&
      hasText('scripts/at.mjs', 'at-group-chat validate --file at.team.json') &&
      hasText('scripts/at.mjs', 'at-group-chat mcp-config') &&
      hasText('scripts/at.mjs', 'at-group-chat recipe sdk') &&
      hasText('scripts/at.mjs', 'recipeContent') &&
      hasText('scripts/at.mjs', 'mcpServers') &&
      hasText('scripts/at.mjs', 'validateManifest') &&
      hasText('scripts/at.mjs', 'templates/github-actions-at-hook.yml') &&
      hasText('scripts/at.mjs', 'templates/external-manager-prompt.md') &&
      hasText('scripts/at.mjs', 'at-group-chat watch RUN_ID') &&
      hasText('scripts/at.mjs', 'readFlag(argv, name, fallback') &&
      hasText('sdk/client.d.ts', 'export class ATClient') &&
      hasText('sdk/client.d.ts', 'runEvents') &&
      hasText('sdk/client.mjs', 'parseSseRecord') &&
      hasText('sdk/client.d.ts', 'hookToken') &&
      hasText('server/openapi.js', '/api/openapi.json') &&
      hasText('server/openapi.js', '/api/hooks/events') &&
      hasText('server/openapi.js', '/api/team/manifest') &&
      hasText('server/openapi.js', '/api/agents/{roleId}/memory') &&
      hasText('templates/github-actions-at-hook.yml', 'vars.AT_TEAM_API_BASE_URL') &&
      hasText('templates/github-actions-at-hook.yml', 'AT_TEAM_HOOK_TOKEN') &&
      hasText('templates/external-manager-prompt.md', 'Manager decision') &&
      hasText('examples/external-manager-sdk.mjs', 'createATClient') &&
      hasText('examples/external-manager-sdk.mjs', "from 'at-group-chat'") &&
      hasText('examples/external-manager-sdk.mjs', 'try {') &&
      hasText('examples/external-manager-sdk.mjs', 'runEvents') &&
      hasText('examples/external-manager-sdk.mjs', 'chat.accepted') &&
      hasText('examples/ci-hook.sh', 'AT_TEAM_HOOK_TOKEN') &&
      hasText('examples/ci-hook.sh', 'GITHUB_RUN_ID') &&
      hasText('scripts/release-readiness.mjs', 'npmLatest') &&
      hasText('scripts/package-smoke.mjs', 'sdk-import') &&
      hasText('scripts/package-smoke.mjs', 'at-group-chat serve') &&
      hasText('scripts/package-smoke.mjs', 'bin-version') &&
      hasText('scripts/package-smoke.mjs', 'bin-doctor-installed') &&
      hasText('scripts/package-smoke.mjs', 'bin-setup-installed') &&
      hasText('scripts/package-smoke.mjs', 'templates-installed') &&
      hasText('scripts/package-smoke.mjs', 'dist-installed') &&
      hasText('scripts/package-smoke.mjs', 'schema-installed') &&
      hasText('scripts/package-smoke.mjs', 'bin-validate') &&
      hasText('scripts/package-smoke.mjs', 'bin-mcp-config') &&
      hasText('scripts/package-smoke.mjs', 'bin-token') &&
      hasText('scripts/package-smoke.mjs', 'bin-env') &&
      hasText('scripts/package-smoke.mjs', 'bin-paths') &&
      hasText('scripts/package-smoke.mjs', 'bin-template') &&
      hasText('scripts/package-smoke.mjs', 'bin-contract') &&
      hasText('scripts/package-smoke.mjs', 'bin-recipe') &&
      hasText('scripts/package-smoke.mjs', 'npm run release:dry-run') &&
      hasText('scripts/package-smoke.mjs', "init', '--all', '--dry-run") &&
      hasText('scripts/package-smoke.mjs', 'at-group-chat proposal "Title"') &&
      hasText('scripts/health.mjs', 'jsonMode') &&
      hasText('scripts/health.mjs', 'generatedAt') &&
      hasText('scripts/release-readiness.mjs', 'pack-required-files') &&
      hasText('scripts/release-readiness.mjs', 'pack-excluded-files') &&
      hasText('scripts/release-readiness.mjs', 'cli-init-dry-run') &&
      hasText('scripts/release-readiness.mjs', 'package/scripts/serve.mjs') &&
      hasText('tests/sdk-cli.test.js', 'packaged developer examples are present') &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'ask'") &&
      hasText('tests/sdk-cli.test.js', 'chat.accepted') &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'watch'") &&
      hasText('tests/sdk-cli.test.js', 'CLI watch exits non-zero when a streamed run fails') &&
      hasText('tests/sdk-cli.test.js', "at.mjs', '--version'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'mcp-config'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'token'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'env'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'paths'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'template'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'recipe'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'proposal'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'work'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'items'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'activity'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'dispatch-work'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'completion'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs', 'validate'") &&
      hasText('tests/sdk-cli.test.js', "at.mjs'), 'init', '--dry-run") &&
      hasText('tests/sdk-cli.test.js', "'init', '--all'") &&
      hasText('README.md', 'at-group-chat init') &&
      hasText('README.md', 'at-group-chat init --all') &&
      hasText('README.md', 'at-group-chat contract --json') &&
      hasText('README.md', 'at-group-chat serve') &&
      hasText('README.md', 'at-group-chat ask') &&
      hasText('README.md', 'JSON Lines') &&
      hasText('README.md', '非 0 退出') &&
      hasText('README.md', 'at-group-chat validate') &&
      hasText('README.md', 'doctor --json') &&
      hasText('README.md', 'at-group-chat --version') &&
      hasText('README.md', 'at-group-chat token --env') &&
      hasText('README.md', 'at-group-chat env') &&
      hasText('README.md', 'at-group-chat paths') &&
      hasText('README.md', 'at-group-chat template external-manager') &&
      hasText('README.md', 'at-group-chat recipe sdk') &&
      hasText('README.md', 'at-group-chat proposal') &&
      hasText('README.md', 'at-group-chat work --type review') &&
      hasText('README.md', 'at-group-chat dispatch-work') &&
      hasText('README.md', 'at-group-chat completion zsh') &&
      hasText('README.md', 'docs/release-notes-1.1.0.md') &&
      hasText('README.md', 'docs/integrations.md') &&
      hasText('README.md', 'docs/environment.md') &&
      hasText('README.md', 'SECURITY.md') &&
      hasText('docs/release-notes-1.1.0.md', 'SECURITY.md') &&
      hasText('docs/release-notes-1.1.0.md', 'docs/integrations.md') &&
      hasText('docs/release-notes-1.1.0.md', 'docs/environment.md') &&
      hasText('docs/integrations.md', 'External Manager Contract') &&
      hasText('docs/integrations.md', 'generic-cli') &&
      hasText('docs/integrations.md', 'at-group-chat recipe') &&
      hasText('docs/integrations.md', 'AT_TEAM_HOOK_TOKEN') &&
      hasText('docs/environment.md', 'AT_TEAM_AGENT_MODE') &&
      hasText('docs/environment.md', 'AT_SETUP_SKIP_ON_INSTALL') &&
      hasText('docs/environment.md', 'CODEX_APP_SERVER_URL') &&
      hasText('env.example', 'AT_TEAM_API_TOKEN=') &&
      hasText('env.example', 'VITE_AT_TEAM_API_BASE_URL') &&
      hasText('docs/completion-audit.md', 'security-release-docs') &&
      hasText('SECURITY.md', 'AT_TEAM_API_TOKEN') &&
      hasText('SECURITY.md', 'permissionProfile') &&
      hasText('SECURITY.md', 'AT_TEAM_DB_PATH') &&
      hasText('SECURITY.md', '/security/advisories/new') &&
      hasText('docs/release-notes-1.1.0.md', 'AT Group Chat 1.1.0 Release Notes') &&
      hasText('docs/release-notes-1.1.0.md', 'at-group-chat --version') &&
      hasText('docs/release-notes-1.1.0.md', 'at-group-chat ask') &&
      hasText('docs/release-notes-1.1.0.md', 'exit non-zero') &&
      hasText('docs/release-notes-1.1.0.md', 'dispatch-work') &&
      hasText('docs/release-notes-1.1.0.md', 'completion zsh') &&
      hasText('docs/release-notes-1.1.0.md', 'npm install -g at-group-chat') &&
      hasText('docs/release-notes-1.1.0.md', "from 'at-group-chat'") &&
      hasText('scripts/package-smoke.mjs', "from 'at-group-chat'") &&
      hasText('CHANGELOG.md', 'at-group-chat ask') &&
      hasText('CHANGELOG.md', 'exit non-zero') &&
      hasText('CHANGELOG.md', 'dispatch-work') &&
      hasText('CHANGELOG.md', 'completion zsh|bash') &&
      hasText('docs/integrations.md', 'at-group-chat ask') &&
      hasText('docs/integrations.md', 'chat.accepted') &&
      hasText('docs/integrations.md', 'non-zero exit code') &&
      hasText('docs/integrations.md', 'AT_EXAMPLE_MAX_EVENTS') &&
      hasText('docs/developer-recipes.md', 'at-group-chat ask') &&
      hasText('docs/developer-recipes.md', 'watch --json') &&
      hasText('docs/developer-recipes.md', 'Inspect and dispatch work from CLI') &&
      hasText('docs/developer-recipes.md', 'Follow a run like CI logs') &&
      hasText('docs/developer-recipes.md', 'Connect an MCP client') &&
      hasText('docs/developer-recipes.md', 'doctor --json') &&
      hasText('docs/developer-recipes.md', 'at-group-chat recipe') &&
      hasText('docs/developer-recipes.md', 'at-group-chat token --env') &&
      hasText('docs/developer-recipes.md', 'Create GitHub-like work items from CLI') &&
      hasText('docs/developer-recipes.md', 'Initialize a repository'),
    'package.json + scripts/at.mjs + sdk + server/openapi.js + templates + examples + tests/sdk-cli.test.js + docs'
  )
];

let platform = null;
let room = null;
try {
  [platform, room] = await Promise.all([
    getJson('http://127.0.0.1:5174/api/platform'),
    getJson('http://127.0.0.1:5174/api/chat')
  ]);
  checks.push(
    item(
      'runtime-readiness',
      'runtime reports readiness gates as green',
      platform.ok && platform.checks?.every((check) => check.ok),
      platform.checks
    ),
    item(
      'codex-app-server',
      'Codex roles use codex app-server and split sessions',
      platform.codexCliServer?.kind === 'codex app-server' &&
        platform.codexCliServer?.connected &&
        platform.checks?.some((check) => check.id === 'codex-session-split' && check.ok),
      platform.codexCliServer
    ),
    item(
      'shared-room',
      'AT room exposes four participants and shared transcript',
      room.participants?.length >= 4 && Array.isArray(room.messages),
      { participants: room.participants?.length, messages: room.messages?.length }
    )
  );
} catch (error) {
  checks.push(item('runtime-api', 'runtime API is reachable for completion audit', false, error.message));
}

const failed = checks.filter((check) => !check.ok);
const eligibleToComplete = now >= CUTOFF && failed.length === 0;
const report = {
  objective: 'AT AI cooperation group chat platform polish and date-time skill',
  root: ROOT,
  localTime: localTime(),
  cutoff: '2026-05-17 07:30:00 CST (+0800)',
  cutoffReached: now >= CUTOFF,
  eligibleToComplete,
  checks
};

console.log(JSON.stringify(report, null, 2));

if (failed.length) process.exit(1);
if (requireCutoff && !eligibleToComplete) process.exit(2);
