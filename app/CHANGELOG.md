# Changelog

## 1.1.0 - 2026-05-17

AT becomes a developer-facing local AI collaboration platform, not only a chat UI.

Full publish notes: `docs/release-notes-1.1.0.md`.

- Added the `at-group-chat` CLI entrypoint for setup, serve, `doctor --json`, status, chat, issue/proposal/review/decision/artifact/work item creation, webhook ingestion, Team as Code manifest apply, run watching, MCP config generation, token generation, and OpenAPI export.
- Added `at-group-chat ask` for one-shot terminal manager runs that create a chat task and stream run events until completion or failure.
- Made `at-group-chat ask` and `watch` exit non-zero when a streamed terminal event reports `agent.failed` or `run.failed`.
- Added CLI work board inspection through `at-group-chat items`, `at-group-chat activity <workItemId>`, and `at-group-chat dispatch-work <workItemId>`.
- Added `at-group-chat completion zsh|bash` for shell completion snippets.
- Added the public JS SDK at `at-group-chat/sdk`.
- Updated the SDK manager example to emit JSON Lines and stream `runEvents()` like CI logs.
- Added `GET /api/openapi.json` so external agents and developer tools can generate clients.
- Added webhook-style event ingestion through `POST /api/hooks/events`, with optional separate `AT_TEAM_HOOK_TOKEN`.
- Added Team as Code via `POST /api/team/manifest` and `at-group-chat apply-manifest --file at.team.json`.
- Added manifest dry-run, idempotent work item seeding, manifest validation, and explicit opt-in for dangerous shell command templates.
- Added `at-group-chat token --env` for separate local admin and webhook tokens.
- Added package smoke coverage for installed CLI help, token generation, MCP config, schema, SDK import, templates, examples, and dist UI.
- Hardened work item project ownership checks, SDK non-JSON error handling, SSE test failure reporting, and manifest transaction rollback.
- Extended the terminal setup wizard with webhook token setup and concrete next commands.
- Updated the UI API panel and sidebar version display for v1.1.0.
