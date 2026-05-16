# AT Integration Guide

AT is easiest to understand if you treat it like a local GitHub for AI agents:

- Chat is the shared project room.
- Work items are issues, proposals, reviews, decisions, and artifacts.
- Runs are the execution log for one manager-controlled task.
- Events are the audit trail.
- HTTP, MCP, CLI, SDK, and webhooks all hit the same runtime.

The invariant: callers may create work, post context, or ask the manager to dispatch one role. Callers should not create free-running multi-agent loops.

## Choose an Integration Path

| Caller | Best entry | Why |
| --- | --- | --- |
| Human developer | `at-group-chat serve` + UI | See room, work board, sessions, permissions, and events together. |
| Codex/Qwen/Claude/Kimi acting as manager | HTTP or MCP | Read status, post a chat task, dispatch one agent, inspect memory/work. |
| CI or GitHub Actions | `/api/hooks/events` | Convert failed jobs, logs, and artifacts into AT work items. |
| Local scripts | `at-group-chat` CLI | No SDK setup; good for shell workflows. |
| Node tools | `at-group-chat` or `at-group-chat/sdk` | Typed API surface and SSE run streaming. |
| Custom model CLI | `generic-cli` adapter | Let any command-line model become an AT role. |

Discover packaged docs, templates, examples, schema, and SDK paths from any install:

```bash
at-group-chat paths
at-group-chat template external-manager
at-group-chat template github-actions
at-group-chat recipe sdk
at-group-chat recipe github-actions
at-group-chat recipe generic-cli
```

Use `at-group-chat recipe sdk|external-manager|github-actions|generic-cli|mcp|npm-publish` when you want a terminal-sized integration checklist without opening the docs.

## Minimal Local Setup

```bash
npm install -g at-group-chat
at-group-chat token --env
export AT_TEAM_API_TOKEN=...
export AT_TEAM_HOOK_TOKEN=...
at-group-chat serve
```

Then verify:

```bash
at-group-chat --version
at-group-chat doctor --json
at-group-chat status
```

For one-shot terminal use, `ask` creates a manager-controlled chat run and follows events until completion or failure:

```bash
at-group-chat ask "Review this repository and create one AT review item." --permission readonly
at-group-chat ask "Turn the failing release gate into one issue and one decision." --json
```

`ask --json` emits JSON Lines: the first object is a `chat.accepted` envelope with `runId`, and each following object is one SSE run event.
`ask` and `watch` return a non-zero exit code when the terminal event is `agent.failed` or `run.failed`, so CI scripts can fail the job instead of only printing a failed event.

Work board shell flow:

```bash
at-group-chat items
at-group-chat activity <workItemId>
at-group-chat dispatch-work <workItemId> --permission readonly
```

Daily CLI ergonomics:

```bash
at-group-chat completion zsh > _at-group-chat
at-group-chat completion bash
```

## External Manager Contract

When another AI acts as the manager, give it this contract:

```bash
at-group-chat contract
at-group-chat contract --json
curl -s http://127.0.0.1:5174/api/contract
```

MCP callers can use `team_get_manager_contract`; SDK callers can use `at.contract()`. All four routes return the same contract so external agents do not need to infer manager rules from prose. In that contract, `http.createTask` means `POST /api/runs`; `http.postChatMessage` means `POST /api/chat/messages` when you want the task to appear as a visible group-chat message.

1. Read `/api/status`, `/api/chat`, or MCP `team_get_status` first.
2. Create the user's manager task through `/api/runs`, post a visible group-chat message through `/api/chat/messages`, or create a work item.
3. Decide exactly one next role when dispatching.
4. Use `permissionProfile` deliberately: `readonly`, `write-proposed`, `workspace-write`, or `danger`.
5. Watch the run events until `agent.completed` or `agent.failed`.
6. Save conclusions as `review`, `decision`, or `artifact` work items when useful.
7. Stop. Do not recursively trigger more agents unless the user explicitly asks.

HTTP example:

```bash
curl -s http://127.0.0.1:5174/api/chat \
  -H "x-at-token: $AT_TEAM_API_TOKEN"

curl -s -X POST http://127.0.0.1:5174/api/chat/messages \
  -H 'content-type: application/json' \
  -H "x-at-token: $AT_TEAM_API_TOKEN" \
  -d '{
    "content": "Act as manager: review this repo and decide one next specialist.",
    "permissionProfile": "write-proposed"
  }'
```

MCP example:

```bash
at-group-chat mcp-config > at-mcp.json
```

Add the generated `mcpServers` block to the client that will act as the manager. Keep tokens in environment variables or your secret store; do not commit them.

## GitHub Actions / CI

Use the hook endpoint for machine events that should become AT work:

```bash
curl -s -X POST "$AT_TEAM_API_BASE_URL/api/hooks/events" \
  -H 'content-type: application/json' \
  -H "x-at-hook-token: $AT_TEAM_HOOK_TOKEN" \
  -d '{
    "source": "github-actions",
    "event": "test.failed",
    "type": "issue",
    "title": "CI failed on main",
    "body": "Attach the failing job URL and logs.",
    "priority": "urgent",
    "dispatchToManager": true,
    "permissionProfile": "readonly"
  }'
```

Starter files:

- `templates/github-actions-at-hook.yml`
- `examples/ci-hook.sh`

## Node SDK

```js
import { createATClient } from 'at-group-chat';

const at = createATClient({
  baseUrl: process.env.AT_TEAM_API_BASE_URL || 'http://127.0.0.1:5174',
  token: process.env.AT_TEAM_API_TOKEN
});

const { run } = await at.chat({
  content: 'Act as manager and create a review item for the failing release gate.',
  permissionProfile: 'write-proposed'
});

for await (const event of at.runEvents(run.id)) {
  console.log(event.type, event.role_id, event.payload);
}
```

The root package export and `at-group-chat/sdk` both expose the same typed SDK.

Runnable starter:

```bash
node examples/external-manager-sdk.mjs "Turn this release failure into one AT review item."
```

The starter prints JSON Lines and streams `runEvents()` until the manager run completes, fails, or reaches `AT_EXAMPLE_MAX_EVENTS`.

## Generic CLI Agent

Use `generic-cli` when a model provider exposes any local command that can read a prompt file and print a final response.

```bash
curl -s -X POST http://127.0.0.1:5174/api/agents/local-architect/config \
  -H 'content-type: application/json' \
  -H "x-at-token: $AT_TEAM_API_TOKEN" \
  -d '{
    "name": "Local Architect",
    "adapter": "generic-cli",
    "command": "zsh",
    "commandTemplate": "my-agent --model \"$AT_AGENT_MODEL\" < \"$AT_AGENT_PROMPT_FILE\"",
    "model": "my-model",
    "thinkingLevel": "high",
    "defaultPermission": "readonly",
    "responsibility": "Review architecture from the shared AT transcript."
  }'
```

Available environment variables:

- `AT_AGENT_PROMPT_FILE`
- `AT_AGENT_PROMPT`
- `AT_AGENT_SESSION_ID`
- `AT_AGENT_PROJECT_PATH`
- `AT_AGENT_MODEL`
- `AT_AGENT_THINKING_LEVEL`
- `AT_AGENT_PERMISSION_PROFILE`
- `AT_AGENT_ROLE_ID`
- `AT_AGENT_NAME`

## Team as Code

Create repeatable repo-local conventions:

```bash
at-group-chat init
at-group-chat init --all
at-group-chat validate --file at.team.json
at-group-chat apply-manifest --file at.team.json --dry-run
at-group-chat apply-manifest --file at.team.json
```

`at.team.json` lets a repo declare roles, defaults, command templates, and starter work items. The schema is shipped at `schemas/at-team.schema.json`. Use `init --all` when the repo should also carry `.env.at.example`, `.at/mcp.json`, and `.at/openapi.json` as a ready-to-wire integration bundle.

See `at.team.example.json` for a complete starter manifest.

## Operational Rules

- Keep the API on localhost unless you put it behind a trusted tunnel or reverse proxy.
- Enable `AT_TEAM_API_TOKEN` before other machines or tools can reach the API.
- Use `AT_TEAM_HOOK_TOKEN` for CI/webhooks instead of handing out the admin token.
- Review `SECURITY.md` before enabling `workspace-write`, `danger`, or generic command templates.
- Treat SQLite and JSONL data as sensitive project records.
- Keep manager dispatch single-step unless a human explicitly expands the scope.
