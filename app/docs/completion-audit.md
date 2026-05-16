# Completion Audit

This checklist explains what `npm run audit` proves before the AT goal can be considered complete.

Final completion is intentionally blocked until after `2026-05-13 07:30:00 CST (+0800)`. Use:

```bash
npm run audit:complete
```

Before that cutoff, a passing audit still reports `eligibleToComplete: false`.

## Checklist

- `date-time-skill`: the reusable date/time skill exists at `/Users/felix/.codex/skills/date-time-check/SKILL.md`, is documented in `README.md`, and includes local `date`, UTC, named timezone, and cutoff comparison rules.
- `manager-skill`: the AT manager skill exists in Codex skills and has a project-readable copy at `docs/agent-manager-skill.md`.
- `verification-scripts`: `package.json` exposes `build`, `typecheck`, `test`, `test:ui`, `test:browser`, `preflight`, `health`, `audit`, `audit:complete`, `smoke:manager`, `verify`, and `verify:complete`.
- `group-chat-ui`: the first screen is the AT group chat, with manager-controlled/no-auto-loop policy and the live Asia/Shanghai 2026-05-13 07:30 completion gate visible in `src/main.jsx`.
- `customize-ui`: Settings exposes model, thinking level, permissions, adapters, command templates, Generic CLI env variables, Team Defaults, portable state export, success feedback, and accessible error feedback.
- `work-items-platform`: AT has GitHub-like collaboration objects (`issue`, `proposal`, `review`, `decision`, `artifact`) exposed in UI, HTTP, MCP, runtime transcript, platform export, activity threads, work-item dispatch, and tests.
- `manager-controlled-tests`: runtime and browser tests cover manager-controlled dispatch, no auto-trigger loops, split Codex sessions, and the primary UI flow.
- `chat-ux-regression-tests`: browser tests cover multiline composer behavior, visible keyboard focus, latest-message autoscroll, `Shift+Enter`, right-aligned user bubbles on desktop and mobile, mobile navigation/quick-mention fit, and no horizontal overflow.
- `http-mcp-surface`: HTTP and MCP expose the same runtime controls for chat messages, dispatch, team config, room state, and SSE.
- `no-codex-exec-runtime`: Codex roles use `codex app-server`; runtime tests prevent falling back to `codex exec`.
- `manager-smoke-script`: `npm run smoke:manager` verifies the real chat API to Codex app-server manager path. It intentionally creates one readonly run/message in the current AT room.
- `memory-isolation-tests`: sessions are keyed by `project_id + role_id`, and tests cover project switching plus separate Codex manager/goal reviewer sessions.
- `customize-runtime-tests`: runtime and browser tests cover model, thinking level, permissions, adapters, generic CLI env, Team Defaults, Settings save feedback, invalid agent feedback without clearing input, and custom agent lane rendering.
- `static-file-boundary`: HTTP static serving is constrained to `dist`, has path traversal coverage, platform export returns a JSON attachment, and client validation errors return 400 without leaking stack traces.
- `code-review-hardening`: the current code-review fixes are present: API base URL/token client, behavior-tested fetch retry, token auth, CORS origin, request size/text field limits, periodic rate limit pruning, CSP headers, sanitized server errors, SSE reconnect/heartbeat cleanup, deduped active dispatch, explicit mock/real adapter mode, multiline output preservation, Error Boundary, React timer ref cleanup, stable refresh callback, narrower memory refresh dependency, dev-only build dependencies, and tests for auth/body limit/dedup/mock fallback.
- `sqlite-storage-driver`: storage uses `better-sqlite3` cached prepared statements with WAL and SQLite `user_version` instead of spawning the external `sqlite3` CLI for every query, and the JSONL mirror is non-blocking.
- `runtime-readiness`: `/api/platform` reports all readiness gates green.
- `codex-app-server`: `/api/platform` confirms the long-running Codex app-server is connected and Codex sessions are split.
- `shared-room`: `/api/chat` exposes AT room participants and persisted shared transcript.

## Final Pass

For daily full verification:

```bash
npm run verify
```

After the cutoff, final completion should use:

```bash
npm run verify:complete
```

`verify:complete` intentionally runs the time-gated audit before the real manager smoke, so running it too early exits before creating another smoke run.

Only mark the goal complete when all of the above pass against the current running app.

`npm run smoke:manager` uses:

- `AT_TEAM_API`, default `http://127.0.0.1:5174`
- `AT_MANAGER_SMOKE_EXPECTED`, default `AT manager smoke OK`
- `AT_MANAGER_SMOKE_TIMEOUT_MS`, default `90000`
