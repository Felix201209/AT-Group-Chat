#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openApiSpec } from '../server/openapi.js';

const ROOT = process.cwd();
const requiredPackEntries = [
  'package/package.json',
  'package/README.md',
  'package/CHANGELOG.md',
  'package/SECURITY.md',
  'package/env.example',
  'package/dist/index.html',
  'package/at.team.example.json',
  'package/scripts/at.mjs',
  'package/scripts/setup.mjs',
  'package/scripts/serve.mjs',
  'package/sdk/client.mjs',
  'package/sdk/client.d.ts',
  'package/schemas/at-team.schema.json',
  'package/server/openapi.js',
  'package/templates/github-actions-at-hook.yml',
  'package/templates/external-manager-prompt.md',
  'package/examples/external-manager-sdk.mjs',
  'package/examples/ci-hook.sh',
  'package/public/favicon.png'
];
const forbiddenPackEntries = [
  'package/scripts/completion-audit.mjs',
  'package/scripts/package-smoke.mjs',
  'package/scripts/release-readiness.mjs'
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    ...options
  }).trim();
}

function check(id, ok, evidence) {
  return { id, ok: Boolean(ok), evidence };
}

function npmViewLatest(name) {
  try {
    return run('npm', ['view', name, 'version', '--silent'], { timeout: 10000 }) || null;
  } catch (error) {
    return { unavailable: true, error: error.message };
  }
}

const pkg = readJson('package.json');
const localVersion = pkg.version;
const latest = npmViewLatest(pkg.name);
run('npm', ['run', 'build'], {
  env: { ...process.env, AT_SETUP_SKIP_ON_INSTALL: '1' }
});
const packJson = JSON.parse(run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  env: { ...process.env, AT_SETUP_SKIP_ON_INSTALL: '1' }
}))[0];
const packEntries = new Set((packJson.files || []).map((file) => `package/${file.path}`));
const initDir = mkdtempSync(join(tmpdir(), 'at-release-init-'));
let initResult = null;

try {
  initResult = JSON.parse(run('node', [join(ROOT, 'scripts/at.mjs'), 'init', '--dry-run'], {
    cwd: initDir,
    env: { ...process.env, AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1' }
  }));
  initResult.all = JSON.parse(run('node', [join(ROOT, 'scripts/at.mjs'), 'init', '--all', '--dry-run'], {
    cwd: initDir,
    env: { ...process.env, AT_TEAM_API_BASE_URL: 'http://127.0.0.1:1' }
  }));
} finally {
  rmSync(initDir, { recursive: true, force: true });
}

const readme = readFileSync('README.md', 'utf8');
const releaseNotes = readFileSync('docs/release-notes-1.1.0.md', 'utf8');
const security = readFileSync('SECURITY.md', 'utf8');
const environmentDoc = readFileSync('docs/environment.md', 'utf8');

const checks = [
  check('version-package-openapi-ui', localVersion === openApiSpec.info.version && readFileSync('src/constants.js', 'utf8').includes(`AT_VERSION = '${localVersion}'`), {
    package: localVersion,
    openapi: openApiSpec.info.version,
    uiConstant: localVersion
  }),
  check('npm-registry-status', typeof latest === 'string' ? latest !== localVersion : true, {
    latest,
    localVersion,
    note: typeof latest === 'string' && latest === localVersion
      ? 'Registry already has this version; publishing would fail without a version bump.'
      : 'Registry is not already at this local version, or registry was unavailable.'
  }),
  check('pack-required-files', requiredPackEntries.every((entry) => packEntries.has(entry)), {
    missing: requiredPackEntries.filter((entry) => !packEntries.has(entry)),
    totalFiles: packJson.files?.length,
    size: packJson.size,
    unpackedSize: packJson.unpackedSize
  }),
  check('pack-excluded-files', forbiddenPackEntries.every((entry) => !packEntries.has(entry)), {
    forbiddenPresent: forbiddenPackEntries.filter((entry) => packEntries.has(entry))
  }),
  check('cli-init-dry-run', initResult?.dryRun === true && initResult.files?.some((file) => file.target.endsWith('at.team.json')) && initResult.all?.files?.some((file) => file.target.endsWith('.at/mcp.json')) && initResult.all?.files?.some((file) => file.target.endsWith('.at/openapi.json')) && initResult.all?.files?.some((file) => file.target.endsWith('.env.at.example')), initResult),
  check('sdk-export-types', pkg.exports?.['.']?.types === './sdk/client.d.ts' && pkg.exports?.['.']?.import === './sdk/client.mjs' && pkg.exports?.['./sdk']?.types === './sdk/client.d.ts' && readFileSync('sdk/client.d.ts', 'utf8').includes('createATClient'), pkg.exports),
  check('package-metadata', Array.isArray(pkg.keywords) && pkg.keywords.includes('mcp') && pkg.keywords.includes('agent-team') && pkg.homepage && pkg.repository?.url, {
    keywords: pkg.keywords,
    homepage: pkg.homepage,
    repository: pkg.repository?.url
  }),
  check('developer-docs', ['at-group-chat init', 'at-group-chat init --all', 'at-group-chat contract --json', 'GET /api/contract', 'team_get_manager_contract', 'at.contract()', 'at-group-chat serve', 'at-group-chat token --env', 'at-group-chat work --type review', 'examples/external-manager-sdk.mjs', 'templates/github-actions-at-hook.yml', 'GET /api/openapi.json', 'docs/release-notes-1.1.0.md', 'docs/integrations.md', 'docs/environment.md', 'SECURITY.md'].every((text) => readme.includes(text)) && releaseNotes.includes('npm install -g at-group-chat') && releaseNotes.includes('SECURITY.md') && releaseNotes.includes('docs/integrations.md') && releaseNotes.includes('docs/environment.md') && security.includes('AT_TEAM_API_TOKEN') && security.includes('/security/advisories/new') && environmentDoc.includes('AT_SETUP_SKIP_ON_INSTALL') && environmentDoc.includes('CODEX_APP_SERVER_URL') && readFileSync('docs/integrations.md', 'utf8').includes('generic-cli'), 'README.md + SECURITY.md + docs/release-notes-1.1.0.md + docs/integrations.md + docs/environment.md')
];

const failed = checks.filter((item) => !item.ok);
const report = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  package: {
    name: pkg.name,
    localVersion,
    npmLatest: latest
  },
  tarball: {
    filename: packJson.filename,
    size: packJson.size,
    unpackedSize: packJson.unpackedSize,
    totalFiles: packJson.files?.length
  },
  checks
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
