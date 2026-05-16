# AT Group Chat 1.1.0 Release Notes

AT Group Chat 1.1.0 turns the project from a local group-chat UI into a developer-facing AI collaboration platform.

## Highlights

- Local manager-controlled AI room with shared transcript and project/role memory isolation.
- Codex roles run through Codex app-server instead of `codex exec`.
- GitHub-like work items: `issue`, `proposal`, `review`, `decision`, and `artifact`.
- HTTP, MCP, CLI, SDK, OpenAPI, webhooks, and Team as Code all use the same runtime.
- Terminal setup wizard starts from npm install when a TTY is available.
- `at-group-chat doctor --json` gives CI and external agents a machine-readable readiness gate.
- `at-group-chat --version` and `at-group-chat version --json` report the package/OpenAPI version from the installed package.
- `at-group-chat token --env` generates separate local admin and webhook tokens.
- `at-group-chat env` prints the packaged environment template, with `--json` for automation.
- `at-group-chat paths` prints installed docs/templates/examples/schema paths for external agents and CI.
- `at-group-chat template <name>` prints packaged external-manager, GitHub Actions, team manifest, and env templates.
- `at-group-chat recipe <name>` prints integration-specific steps for SDK, external managers, GitHub Actions, generic CLI agents, MCP, and npm publishing.
- `at-group-chat mcp-config` prints an MCP client config for AT.
- `at-group-chat ask "..."` creates a manager-controlled task and follows the run like a one-shot CI log.
- `at-group-chat ask` and `watch` now exit non-zero on streamed `agent.failed` or `run.failed` terminal events.
- `at-group-chat items`, `activity`, and `dispatch-work` expose the GitHub-like work board from shell scripts.
- `at-group-chat completion zsh|bash` prints shell completion snippets for daily CLI use.
- `at-group-chat watch <runId>` follows a manager run like CI logs.
- `docs/integrations.md` explains how programmers connect external managers, CI, MCP clients, SDK scripts, and generic model CLIs.
- `docs/environment.md` and `env.example` centralize runtime, token, frontend, Codex server, and smoke-test configuration.

## Install

```bash
npm install -g at-group-chat
at-group-chat setup
at-group-chat serve
```

Or run from the repo:

```bash
npm install
npm run dev
```

## Developer Entry Points

```bash
at-group-chat doctor --json
at-group-chat --version
at-group-chat version --json
at-group-chat serve
at-group-chat token --env
at-group-chat env --json
at-group-chat paths
at-group-chat template external-manager
at-group-chat contract --json
curl -s http://127.0.0.1:5174/api/contract
at-group-chat recipe sdk
at-group-chat recipe github-actions
at-group-chat init --github --manager-prompt
at-group-chat init --all
at-group-chat ask "Act as manager: inspect this repo and stream events until done."
at-group-chat chat "Act as manager: inspect this repo and decide one next reviewer."
at-group-chat issue "Review API stability" --body "Check HTTP/MCP/SDK/CLI." --priority high --dispatch
at-group-chat proposal "Refactor adapter registry" --body "Implementation plan and rollout."
at-group-chat review "CLI package API review" --body "Review notes and required changes."
at-group-chat decision "Ship v1.1.0" --body "Final release decision and evidence."
at-group-chat artifact "release evidence" --body "Build URL, logs, or exported report."
at-group-chat work --type review "Generic review item" --body "Use --type for issue/proposal/review/decision/artifact."
at-group-chat items
at-group-chat activity <workItemId>
at-group-chat dispatch-work <workItemId> --permission readonly
at-group-chat completion zsh > _at-group-chat
at-group-chat mcp-config > at-mcp.json
at-group-chat openapi > at-openapi.json
```

## SDK

```js
import { createATClient } from 'at-group-chat';

const at = createATClient({
  baseUrl: process.env.AT_TEAM_API_BASE_URL,
  token: process.env.AT_TEAM_API_TOKEN
});

const task = await at.chat({
  content: 'Act as manager and create the next review item.',
  permissionProfile: 'write-proposed'
});

for await (const event of at.runEvents(task.run.id)) {
  console.log(event.type, event.role_id, event.payload);
}
```

The package root and the explicit `at-group-chat/sdk` subpath expose the same typed SDK, so existing subpath imports continue to work.

## Verification

Before publishing this version, the local release gate passed:

```bash
npm run release:dry-run
npm run typecheck
npm test
npm run package:smoke
npm run release:readiness
npm run audit
```

`release:readiness` confirmed npm registry latest was `1.0.3` while local package version is `1.1.0`.

## Compatibility

- Requires Node.js 20 or newer.
- First release in this line to expose the full CLI/SDK/OpenAPI/MCP developer surface.
- Existing HTTP and MCP runtime APIs remain compatible; 1.1.0 adds new fields and commands rather than removing old ones.
- Localhost-first by design. Use `AT_TEAM_API_TOKEN` and `AT_TEAM_HOOK_TOKEN` when other tools or machines can reach the API.
- See `SECURITY.md` before enabling real agents, generic CLI adapters, `workspace-write`, or `danger` permissions.
