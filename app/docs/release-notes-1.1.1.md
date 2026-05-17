# AT Group Chat 1.1.1 Release Notes

AT Group Chat 1.1.1 is a patch release focused on npm install polish, terminal setup reliability, and version consistency after the 1.1.0 platform release.

## Highlights

- Terminal setup choices now support both `↑/↓` navigation and number shortcuts.
- The setup wizard restores terminal raw mode on cancel/SIGINT and exits with code `130` when the user cancels.
- Default setup choices now favor generated API and webhook tokens.
- Server-side OpenAPI, MCP, and Codex app-server client versions now read from `package.json`.
- `at-group-chat doctor --json` checks the current Node engine / Node.js version against the package engine.
- Release readiness now passes after the same package version has already been published, while warning to skip republish unless the version is bumped.

## Verify

```bash
npm run typecheck
npm test
npm run audit
npm run package:smoke
npm run release:readiness
```

## Publish

```bash
npm publish --tag latest
```

If the registry already reports `1.1.1`, do not publish again; bump the version first.
