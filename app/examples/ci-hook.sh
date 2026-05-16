#!/usr/bin/env bash
set -euo pipefail

: "${AT_TEAM_API_BASE_URL:=http://127.0.0.1:5174}"
: "${AT_TEAM_HOOK_TOKEN:?Set AT_TEAM_HOOK_TOKEN before sending CI hook events}"

TITLE="${1:-CI failed}"
BODY="${2:-Attach logs, changed files, and run URL.}"
DEDUPE_KEY="${3:-ci:${GITHUB_RUN_ID:-${CI_JOB_ID:-manual}}:${GITHUB_SHA:-${CI_COMMIT_SHA:-unknown}}}"

curl -fsS -X POST "${AT_TEAM_API_BASE_URL}/api/hooks/events" \
  -H 'content-type: application/json' \
  -H "x-at-hook-token: ${AT_TEAM_HOOK_TOKEN}" \
  -d @- <<JSON
{
  "source": "ci",
  "event": "test.failed",
  "type": "issue",
  "title": "${TITLE}",
  "body": "${BODY}",
  "priority": "urgent",
  "dedupeKey": "${DEDUPE_KEY}",
  "dispatchToManager": true,
  "permissionProfile": "readonly"
}
JSON
