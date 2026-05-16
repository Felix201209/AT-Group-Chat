import { ensureCodexCliServer, getCodexCliServerStatus } from '../server/codexCliServer.js';

const result = await ensureCodexCliServer({ stdio: 'pipe' });
const status = await getCodexCliServerStatus();

if (result.alreadyRunning) {
  console.log(`Codex CLI server already running at ${status.url}`);
} else {
  console.log(`Codex CLI server starting at ${status.url}`);
}

if (result.warning) console.warn(result.warning);

if (!result.child) {
  setInterval(() => {}, 60_000);
} else {
  result.child.on('exit', (code, signal) => {
    console.log(`Codex CLI server exited code=${code ?? ''} signal=${signal ?? ''}`);
    process.exit(code ?? (signal ? 1 : 0));
  });
}
