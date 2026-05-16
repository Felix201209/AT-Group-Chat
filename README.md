# AT Group Chat Website

[![AT App CI](https://github.com/Felix201209/AT-Group-Chat/actions/workflows/app-ci.yml/badge.svg)](https://github.com/Felix201209/AT-Group-Chat/actions/workflows/app-ci.yml)

This folder is the publish-ready showcase package for AT Group Chat.

Current app/npm version: `1.1.0`.

## What is here

- `index.html`, `features.html`, `technology.html`, `docs.html`: static public website.
- `styles.css`, `script.js`: website styling and small interactions.
- `preview-*.png`, `v2-*.png`: page preview images for earlier and current showcase passes.
- `app/`: bundled AT local platform source, copied from `/Users/felix/Desktop/AT Group Chat`.
- `deploy/raspberry-pi.md`: notes for the later Raspberry Pi public deployment.

## Local preview

```bash
cd /Users/felix/Desktop/styles-refero-design-clone/at-group-chat-website
python3 -m http.server 8123
```

Open `http://127.0.0.1:8123/`.

## Run the actual AT platform

```bash
npm install -g at-group-chat
at-group-chat setup
at-group-chat serve
at-group-chat doctor --json
```

Or run the bundled source checkout:

```bash
cd /Users/felix/Desktop/styles-refero-design-clone/at-group-chat-website/app
npm install
npm run setup
npm run dev
```

The static website is the public story. The real AT control console still runs locally and connects to the local API, MCP runtime, and Codex app-server.

## CI

`.github/workflows/app-ci.yml` verifies the bundled app on push and pull request:

```bash
cd app
npm ci
npm run typecheck
npm test
npm run build
npm run package:smoke
npm run release:readiness
```

The workflow uses mock agent mode and skips install-time setup prompts so CI stays deterministic.

## GitHub target

The website links point to:

```text
https://github.com/Felix201209/AT-Group-Chat
```

The public repository has been created and this folder is pushed as its source root. Future changes can be committed from this folder and pushed to `main`.
