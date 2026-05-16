# Environment Variables

Use `at-group-chat token --env` to generate token values, then copy `env.example` to `.env` or export only the variables you need.

Do not commit real `.env` files. `env.example` is safe because it contains placeholders only.

From an installed package, print the same template with:

```bash
at-group-chat env
at-group-chat env --json
```

## Quick Profiles

### Local Demo

```bash
AT_TEAM_AGENT_MODE=mock
AT_TEAM_API_TOKEN=
npm run dev
```

### Local Real Agents

```bash
export AT_TEAM_AGENT_MODE=real
export AT_TEAM_API_TOKEN="$(at-group-chat token --env | awk -F= '/AT_TEAM_API_TOKEN/ {print $2}')"
at-group-chat serve
```

### External Manager Or CI Can Reach AT

```bash
export AT_TEAM_API_TOKEN=...
export AT_TEAM_HOOK_TOKEN=...
export AT_TEAM_CORS_ORIGIN=http://127.0.0.1:5173
at-group-chat serve
```

## Core Runtime

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `AT_TEAM_AGENT_MODE` | `real` | runtime, scripts | `mock` is for demos/tests. `real` invokes configured local agents. |
| `AT_TEAM_PORT` | `5174` | HTTP server, serve script | API/UI port for packaged `serve`. `PORT` can also be used by hosts. |
| `AT_TEAM_DB_PATH` | `./data/at-team.sqlite` | storage, MCP config, serve | SQLite source of truth. Treat it as sensitive project data. |
| `AT_TEAM_PUBLIC_DIR` | package `dist` or local `dist` | HTTP server | Static UI directory. Useful when serving a built UI from another path. |
| `CODEX_APP_SERVER_URL` | `ws://127.0.0.1:5176` | Codex adapter | Preferred Codex app-server endpoint. |
| `CODEX_EXEC_SERVER_URL` | unset | Codex adapter | Backward-compatible fallback alias for the same WebSocket URL. |

## Authentication

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `AT_TEAM_API_TOKEN` | empty | HTTP, SDK, MCP, UI | Local admin token. Required by API routes when set. |
| `AT_TEAM_HOOK_TOKEN` | empty | `/api/hooks/events` | Separate webhook/CI token. Prefer this for GitHub Actions. |
| `VITE_AT_TEAM_API_TOKEN` | empty | frontend build/dev | Browser token used when UI and API are split. Do not bake real shared secrets into public builds. |

Token transport:

- HTTP/SDK: `x-at-token: ...` or `Authorization: Bearer ...`
- SSE: query token when EventSource headers are unavailable
- Hook endpoint: `x-at-hook-token: ...` or `Authorization: Bearer ...`

## Safety And Limits

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `AT_TEAM_CORS_ORIGIN` | `http://127.0.0.1:5173` | HTTP server | Keep this explicit when other tools can reach the API. |
| `AT_TEAM_MAX_BODY_BYTES` | `1048576` | HTTP server | Whole request body limit. |
| `AT_TEAM_MAX_TEXT_FIELD_LENGTH` | `32000` | runtime validation | Per-field text limit for prompts, bodies, and metadata-like inputs. |
| `AT_TEAM_RATE_LIMIT_WINDOW_MS` | `60000` | HTTP server | Rate-limit window. |
| `AT_TEAM_RATE_LIMIT_MAX` | `600` | HTTP server | Max requests per window per client key. |

## Frontend

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `VITE_AT_TEAM_API_BASE_URL` | same origin | frontend | Set when Vite UI talks to a separate API port or host. |
| `VITE_AT_TEAM_API_TOKEN` | empty | frontend | Optional browser-side token for local UI. |

## CLI, SDK, MCP, And Hooks

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `AT_TEAM_API_BASE_URL` | `http://127.0.0.1:5174` | CLI, SDK, examples | Base URL for external managers and local scripts. |
| `AT_TEAM_API_TOKEN` | empty | CLI, SDK, MCP | Same admin token as HTTP. |
| `AT_TEAM_HOOK_TOKEN` | empty | CLI hook, examples, GitHub Actions | Token for webhook ingestion. |

## Manager Smoke

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `AT_TEAM_API` | `http://127.0.0.1:5174` | `npm run smoke:manager` | Runtime URL for the real manager smoke. |
| `AT_MANAGER_SMOKE_EXPECTED` | `AT manager smoke OK` | smoke script | Expected short response from manager. |
| `AT_MANAGER_SMOKE_TIMEOUT_MS` | `90000` | smoke script | Polling timeout. |

## Install Wizard

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `AT_SETUP_SKIP_ON_INSTALL` | empty | postinstall, CI | Set to `1` in CI or scripted installs to skip the interactive wizard. |
| `CI` | host-dependent | postinstall | Also skips the install wizard. |

## Generic CLI Agent Runtime

These are injected into `generic-cli` commands. You normally do not set them yourself:

| Variable | Default | Used by | Notes |
| --- | --- | --- | --- |
| `AT_AGENT_PROMPT_FILE` | generated temp file | generic CLI adapter | Path to the full role prompt. Prefer this for large prompts. |
| `AT_AGENT_PROMPT` | generated prompt text | generic CLI adapter | Full prompt text in an environment variable. |
| `AT_AGENT_SESSION_ID` | role session id | generic CLI adapter | Stable project+role session id for custom memory. |
| `AT_AGENT_PROJECT_PATH` | current project path | generic CLI adapter | Workspace path for the active project. |
| `AT_AGENT_MODEL` | role model | generic CLI adapter | Model string configured in Settings or Team as Code. |
| `AT_AGENT_THINKING_LEVEL` | role thinking level | generic CLI adapter | One of `default`, `minimal`, `low`, `medium`, `high`, `xhigh`. |
| `AT_AGENT_PERMISSION_PROFILE` | dispatch permission | generic CLI adapter | One of `readonly`, `write-proposed`, `workspace-write`, `danger`. |
| `AT_AGENT_ROLE_ID` | role id | generic CLI adapter | Stable AT role id. |
| `AT_AGENT_NAME` | role display name | generic CLI adapter | Human-readable role name. |

See `docs/integrations.md` for a full generic CLI adapter recipe.
