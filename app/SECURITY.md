# Security

AT Group Chat is designed as a localhost-first AI collaboration platform. It can start local agent CLIs, persist transcripts, and dispatch manager-controlled work, so security settings should be treated as part of setup rather than an afterthought.

## Localhost Boundary

- Default API: `http://127.0.0.1:5174`
- Default UI in source mode: `http://127.0.0.1:5173`
- Default packaged serve mode: `http://127.0.0.1:5174`
- Default Codex app-server: `ws://127.0.0.1:5176`

Do not expose the API directly to the public internet. If another device or external manager needs access, put it behind a trusted tunnel, firewall, or reverse proxy and enable tokens.

## Tokens

Generate local tokens with:

```bash
at-group-chat token --env
```

Use:

- `AT_TEAM_API_TOKEN` for local admin HTTP, SDK, MCP, and UI access.
- `AT_TEAM_HOOK_TOKEN` for webhook or CI ingestion only.

Never commit real tokens. Keep them in `.env`, your shell, or a secret manager.

`VITE_AT_TEAM_API_TOKEN` is a browser-side convenience for local split-port development. Do not bake a real shared admin token into a public or shared frontend build; prefer serving the UI and API from localhost with explicit access controls.

## Permissions

Agent dispatches use a `permissionProfile`:

- `readonly`: inspect and report only.
- `write-proposed`: propose changes and patches, but treat writes as reviewable.
- `workspace-write`: allow workspace writes.
- `danger`: high-risk operations; use only after explicit human approval.

AT is manager-controlled by design. Agents should not freely loop, recursively dispatch, or escalate permissions without an explicit manager/user decision.

## Data Storage

By default, AT stores local data in:

```text
./data/at-team.sqlite
./data/events.jsonl
```

The SQLite database is the source of truth. JSONL is an audit mirror. Both may contain prompts, agent responses, project paths, session identifiers, work items, and review notes. Treat the data directory as sensitive project data.

Override the database location with:

```bash
AT_TEAM_DB_PATH=/secure/path/at-team.sqlite at-group-chat serve
```

## Local Agent Execution

AT can invoke Codex app-server, Claude Code, Kimi Code CLI, or a configured generic CLI adapter. Before using real mode:

```bash
at-group-chat doctor --json
```

Review every configured adapter command and command template before enabling `workspace-write` or `danger`.

## CORS and Body Limits

Recommended local hardening:

```bash
AT_TEAM_CORS_ORIGIN=http://127.0.0.1:5173
AT_TEAM_MAX_BODY_BYTES=1048576
AT_TEAM_MAX_TEXT_FIELD_LENGTH=32000
AT_TEAM_RATE_LIMIT_MAX=600
```

See `docs/environment.md` and `env.example` for the full environment variable reference.

## Reporting Issues

For security-sensitive issues, do not paste secrets or private code into public issues. Prefer a private GitHub security advisory draft:

```text
https://github.com/Felix201209/AT-Group-Chat/security/advisories/new
```

If private advisories are unavailable, open only a minimal public coordination issue with no exploit details, secrets, logs, or private code:

```text
https://github.com/Felix201209/AT-Group-Chat/issues
```

Include:

- AT version
- Node version
- Relevant `at-group-chat doctor --json` result with secrets removed
- Reproduction steps
- Whether real agents, generic CLI adapters, or `danger` permissions were involved
