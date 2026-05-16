# Raspberry Pi Deployment Notes

Goal: host the static showcase website publicly from the Raspberry Pi, while keeping the AT control console local unless Felix explicitly asks to expose it.

Current public URL:

```text
https://at-group-chat.felixypz.me/
```

## Safe boundary

- Public: static files in this folder root.
- Private/local: `app/data/`, runtime SQLite, JSONL logs, API tokens, and live agent execution.
- Do not expose ports `5174` or `5176` publicly unless Felix explicitly asks for a remote control plane.

## Later deploy shape

From this folder:

```bash
rsync -av --delete \
  --exclude app/node_modules \
  --exclude app/data \
  --exclude app/dist \
  --exclude app/test-results \
  ./ pi@192.168.0.109:/home/pi/at-group-chat-website/
```

Then serve `/home/pi/at-group-chat-website` with nginx or the existing Cloudflare tunnel/static-site setup on the Pi.

Current Pi deployment path and services:

```text
/home/pi/sites/at-group-chat-website/current
at-group-chat.service -> http://127.0.0.1:8898
codex-manager-cloudflared.service -> at-group-chat.felixypz.me
```

## Verification checklist

- Home, Features, Technology, and Docs return `200`.
- No public page links to `127.0.0.1`, `localhost`, or private Pi IP.
- GitHub links are updated to the final repository.
- `app/data` is absent from the deployed directory.
- The public site clearly says AT is manager-controlled, not an unrestricted autonomous loop.
