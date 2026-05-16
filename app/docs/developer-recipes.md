# AT Developer Recipes

AT copies the developer ergonomics of GitHub into local AI collaboration:

- GitHub issue -> AT `issue`
- Pull request -> AT `proposal`
- Code review -> AT `review`
- Merge decision -> AT `decision`
- CI artifact/log -> AT `artifact`
- GitHub webhook -> HTTP/MCP caller that creates work items or chat messages
- GitHub CLI/API client -> `at-group-chat` CLI and `sdk/client.mjs`

The rule that must not change: AT is manager-controlled. External tools may create work, post chat messages, or ask the manager to dispatch one role. They should not create free agent loops.

From an installed package, use `at-group-chat recipe sdk|external-manager|github-actions|generic-cli|mcp|npm-publish` to print the relevant commands, files, and docs for the integration path you are wiring up.

## Initialize a repository

Run this in any code repo when you want AT conventions checked in beside your source code:

```bash
at-group-chat init
```

It creates:

- `at.team.json`: repeatable Team as Code roles/defaults/work items.
- `.github/workflows/at-hook.yml`: CI failure webhook starter.
- `docs/at-external-manager.md`: prompt contract for an outside manager agent.

Preview without writing:

```bash
at-group-chat init --dry-run
at-group-chat validate --file at.team.json
```

`schemas/at-team.schema.json` is shipped in the npm package so editors and CI can validate AT manifests before they hit the runtime. The CLI validator also blocks unsafe shell-control command templates unless the manifest explicitly sets `dangerousCommandTemplate: true`.

## Check release readiness

Before publishing a package version, run:

```bash
at-group-chat --version
at-group-chat version --json
at-group-chat doctor --json
at-group-chat serve
at-group-chat token --env
npm run release:readiness
npm run package:smoke
npm run release:dry-run
npm publish --tag latest
```

`at-group-chat doctor --json` runs the local readiness gate and emits `{ ok, checks, failed }` for CI, external managers, or shell scripts.

`doctor --json` fields are stable for automation: `ok` is the overall boolean, `generatedAt` is ISO 8601, `checks[]` contains `{ name, ok, detail }`, and `failed[]` is the subset of failing check objects. The command exits `0` only when `ok` is true.

`at-group-chat token` generates separate local admin and webhook tokens. Use `at-group-chat token --env` when you want `.env`-ready `AT_TEAM_API_TOKEN` and `AT_TEAM_HOOK_TOKEN` lines.

`release:readiness` checks the local version against OpenAPI/UI constants, compares against the current npm registry version when available, verifies the dry-run package contains SDK/templates/examples, and exercises `at-group-chat init --dry-run`.

`package:smoke` installs the generated tarball into a temporary project and verifies the installed `at-group-chat` binary, OpenAPI command, init dry-run, SDK import, templates, examples, and dist UI.

`release:dry-run` chains typecheck, unit/runtime tests, `release:readiness`, `package:smoke`, and `npm publish --dry-run --json`. It is the safest final command to run immediately before the real publish.

## One-line local manager task

```bash
at-group-chat ask "Act as manager: inspect the current repo and stream events until the run finishes."
at-group-chat chat "Act as manager: inspect the current repo and create the next issue/review/decision."
```

Use `ask` when you want one command that both creates the manager-controlled run and follows the event stream. Use `chat` when a script only needs the JSON response and will call `watch` later.
`ask --json` and `watch --json` emit JSON Lines, one object per line, so shell tools can process long runs without waiting for a full JSON array.

## Create an issue and immediately hand it to manager

```bash
at-group-chat issue "Review API stability before release" \
  --body "Check HTTP, MCP, SDK, CLI, and setup wizard contract." \
  --priority high \
  --dispatch
```

## Create GitHub-like work items from CLI

```bash
at-group-chat proposal "Refactor adapter registry" --body "Implementation plan, risks, and rollout."
at-group-chat review "CLI package API review" --body "Review notes and required changes."
at-group-chat decision "Ship v1.1.0" --body "Final release decision and evidence."
at-group-chat artifact "release evidence" --body "Build URL, log path, or exported report."
at-group-chat work --type review "Generic work item" --body "Use --type for issue/proposal/review/decision/artifact."
```

These commands map directly to the AT work board. Add `--dispatch` when the manager should turn the item into a controlled run.

## Inspect and dispatch work from CLI

```bash
at-group-chat items
at-group-chat activity <workItemId>
at-group-chat dispatch-work <workItemId> --permission readonly
```

This is the terminal equivalent of listing issues, opening a PR/activity thread, and asking the manager to review a specific work item.

## Install shell completion

```bash
at-group-chat completion zsh > _at-group-chat
at-group-chat completion bash
```

The completion output is static and safe to redirect into your shell completion directory or inspect before installing.

## Use the JavaScript SDK from another local agent

Runnable example:

```bash
node examples/external-manager-sdk.mjs "请把当前失败的发布检查转成一个 AT work item，并决定下一位 reviewer。"
```

The example emits JSON Lines: first `chat.accepted`, then streamed run events from `runEvents()`.

```js
import { createATClient } from 'at-group-chat/sdk';

const at = createATClient({
  baseUrl: process.env.AT_TEAM_API_BASE_URL,
  token: process.env.AT_TEAM_API_TOKEN
});

const issue = await at.createWorkItem({
  type: 'issue',
  title: 'External agent found a failing test',
  body: 'Attach logs and ask manager to decide one next reviewer.',
  priority: 'high',
  dispatchToManager: true,
  permissionProfile: 'write-proposed'
});

console.log(issue);
```

## Follow a run like CI logs

When an external manager creates a chat task or work item dispatch, keep the returned `run.id` and stream the run just like a GitHub Actions log.

```bash
at-group-chat watch <runId> --max 20
at-group-chat watch <runId> --json --after 120
```

`watch` follows the run SSE stream and exits after `--max` events when provided. Without `--max`, stop it with `Ctrl-C`; the SDK and CLI close the SSE reader on exit so long-running manager processes do not leak a stream.

SDK equivalent:

```js
for await (const event of at.runEvents(run.id, { after: 0 })) {
  console.log(event.id, event.type, event.role_id, event.payload);
}
```

## Generic CLI adapter recipe

Use `generic-cli` when your model can read a prompt from a file and print a final answer.

```bash
curl -s -X POST http://127.0.0.1:5174/api/agents/local-reviewer/config \
  -H 'content-type: application/json' \
  -d '{
    "name": "Local Reviewer",
    "adapter": "generic-cli",
    "command": "zsh",
    "commandTemplate": "my-agent --model \"$AT_AGENT_MODEL\" < \"$AT_AGENT_PROMPT_FILE\"",
    "model": "my-model",
    "thinkingLevel": "high",
    "defaultPermission": "readonly",
    "responsibility": "Review code from the shared AT transcript."
  }'
```

Runtime environment variables available to the command:

- `AT_AGENT_PROMPT_FILE`
- `AT_AGENT_PROMPT`
- `AT_AGENT_SESSION_ID`
- `AT_AGENT_PROJECT_PATH`
- `AT_AGENT_MODEL`
- `AT_AGENT_THINKING_LEVEL`
- `AT_AGENT_PERMISSION_PROFILE`
- `AT_AGENT_ROLE_ID`
- `AT_AGENT_NAME`

## CI-style gate

Treat AT like a local CI reviewer. CI creates an issue/proposal, manager chooses exactly one specialist, and the result becomes review/decision text.

```bash
curl -s -X POST http://127.0.0.1:5174/api/work-items \
  -H 'content-type: application/json' \
  -d '{
    "type": "proposal",
    "title": "Pre-release review for v1.1.0",
    "body": "Check whether the package install wizard, SDK, CLI, and OpenAPI are ready.",
    "priority": "urgent",
    "dispatchToManager": true,
    "permissionProfile": "readonly"
  }'
```

## Webhook-style event ingestion

Use `/api/hooks/events` when a developer tool wants to notify AT without pretending to be a chat user.
For a GitHub Actions starting point, copy `templates/github-actions-at-hook.yml`.
For a local shell example, run `examples/ci-hook.sh`.

```bash
curl -s -X POST http://127.0.0.1:5174/api/hooks/events \
  -H 'content-type: application/json' \
  -H "x-at-hook-token: $AT_TEAM_HOOK_TOKEN" \
  -d '{
    "source": "github-actions",
    "event": "test.failed",
    "type": "issue",
    "title": "CI failed on main",
    "body": "Attach the failed job URL, logs, and changed files.",
    "priority": "urgent",
    "dispatchToManager": true,
    "permissionProfile": "readonly",
    "metadata": {
      "runUrl": "https://github.com/example/repo/actions/runs/123"
    }
  }'
```

When `AT_TEAM_HOOK_TOKEN` is configured, webhook callers use that token instead of the main local admin token. This lets CI or external agents create work items without getting broad platform access.

CLI equivalent:

```bash
at-group-chat hook \
  --source github-actions \
  --event test.failed \
  --title "CI failed on main" \
  --body "Attach logs and ask manager for one next reviewer." \
  --priority urgent \
  --dispatch
```

## Generate a client

```bash
curl -s http://127.0.0.1:5174/api/openapi.json > at-openapi.json
```

Feed that file into your OpenAPI generator, API client, or agent tool schema generator.

## Connect an MCP client

AT ships an MCP server that exposes the same manager-controlled runtime as HTTP and the UI. Generate a ready-to-paste config:

```bash
at-group-chat mcp-config > at-mcp.json
```

The output contains a `mcpServers.at-group-chat` entry that runs `server/mcp.js` with the local Node runtime and carries `AT_TEAM_API_BASE_URL`, `AT_TEAM_DB_PATH`, and optional token env vars. Keep real tokens in your shell or secret store; do not commit them.

## Team as Code

Put an `at.team.json` file in a repo when you want repeatable agent setup.

```bash
cp at.team.example.json at.team.json
at-group-chat validate --file at.team.json
at-group-chat apply-manifest --file at.team.json --dry-run
at-group-chat apply-manifest --file at.team.json
```

The manifest can set team defaults, add generic CLI agents, and seed issue/proposal/review/decision/artifact items. This is the AT equivalent of keeping GitHub Actions workflows or CODEOWNERS in the repo. Re-running the same manifest is safe: work items use a stable `manifestKey` and converge instead of duplicating.

For generic CLI agents, simple prompt-file templates such as `my-agent < "$AT_AGENT_PROMPT_FILE"` are allowed. If a manifest command template contains shell control syntax such as `;`, `&&`, backticks, or `$()`, AT requires `dangerousCommandTemplate: true` so the risk is explicit in code review.

## Stop conditions for external managers

Every external manager should write a stop condition before dispatching:
For a reusable prompt contract, copy `templates/external-manager-prompt.md`.

```text
Manager decision:
- Current state:
- Agent to call next:
- Reason:
- Permission:
- Stop condition:
```

If no more specialists are needed, `Agent to call next` must be `none`.
