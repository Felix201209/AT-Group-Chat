# AT Group Chat Website

This folder is the publish-ready showcase package for AT Group Chat.

## What is here

- `index.html`, `features.html`, `technology.html`, `docs.html`: static public website.
- `styles.css`, `script.js`: website styling and small interactions.
- `preview-*.png`: existing page preview images.
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
cd /Users/felix/Desktop/styles-refero-design-clone/at-group-chat-website/app
npm install
npm run dev
```

The static website is the public story. The real AT control console still runs locally and connects to the local API, MCP runtime, and Codex app-server.

## GitHub target

The website links point to:

```text
https://github.com/Felix201209/AT-Group-Chat
```

The public repository has been created and this folder is pushed as its source root. Future changes can be committed from this folder and pushed to `main`.
