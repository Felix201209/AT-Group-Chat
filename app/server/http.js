import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtime } from './singleton.js';
import { MAX_TEXT_FIELD_LENGTH } from './constants.js';
import { ClientError, isClientError as isTypedClientError } from './errors.js';
import { openApiSpec } from './openapi.js';

const PORT = Number(process.env.PORT || process.env.AT_TEAM_PORT || 5174);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cwdDist = join(process.cwd(), 'dist');
const PUBLIC_DIR = process.env.AT_TEAM_PUBLIC_DIR || (existsSync(cwdDist) ? cwdDist : join(APP_ROOT, 'dist'));
const PUBLIC_ROOT = resolve(PUBLIC_DIR);
const API_TOKEN = process.env.AT_TEAM_API_TOKEN || '';
const HOOK_TOKEN = process.env.AT_TEAM_HOOK_TOKEN || '';
const CORS_ORIGIN = process.env.AT_TEAM_CORS_ORIGIN || 'http://127.0.0.1:5173';
const MAX_BODY_BYTES = Number(process.env.AT_TEAM_MAX_BODY_BYTES || 1024 * 1024);
const RATE_LIMIT_MAX = Number(process.env.AT_TEAM_RATE_LIMIT_MAX || 600);
const RATE_LIMIT_WINDOW_MS = Number(process.env.AT_TEAM_RATE_LIMIT_WINDOW_MS || 60_000);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const rateLimitMap = new Map();
const rateLimitPruneTimer = RATE_LIMIT_MAX
  ? setInterval(() => pruneRateLimit(), Math.max(RATE_LIMIT_WINDOW_MS, 60_000))
  : null;
rateLimitPruneTimer?.unref?.();

function pruneRateLimit(now = Date.now()) {
  for (const [key, record] of rateLimitMap) {
    if (now > record.resetAt) rateLimitMap.delete(key);
  }
}

function checkRateLimit(clientIp) {
  if (!RATE_LIMIT_MAX) return true;
  const now = Date.now();
  if (rateLimitMap.size > RATE_LIMIT_MAX * 4) pruneRateLimit(now);
  const record = rateLimitMap.get(clientIp);
  if (!record) {
    rateLimitMap.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + RATE_LIMIT_WINDOW_MS;
    return true;
  }
  record.count += 1;
  return record.count <= RATE_LIMIT_MAX;
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': CORS_ORIGIN,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-at-token',
    ...extraHeaders
  });
  res.end(JSON.stringify(body, null, 2));
}

function validateTextFields(value, path = 'body') {
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT_FIELD_LENGTH) {
      throw new ClientError(`${path} exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTextFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    validateTextFields(child, `${path}.${key}`);
  }
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let length = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      length += chunk.length;
      if (length > maxBytes) {
        rejected = true;
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      if (rejected) return;
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        validateTextFields(parsed);
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isClientError(error) {
  if (isTypedClientError(error)) return true;
  return [
    'roleId is required',
    'roleId must be',
    'unsupported adapter',
    'requires commandTemplate',
    'unsupported thinkingLevel',
    'Unknown role',
    'Unknown agent',
    'No team config fields provided',
    'No active agents matched team config update',
    'Invalid permission profile',
    'work item title is required',
    'Unsupported work item type',
    'Unsupported work item status',
    'Unsupported work item priority',
    'Unknown work item',
    'Request body too large'
  ].some((message) => error.message?.includes(message));
}

function serveStatic(req, res) {
  if (!existsSync(PUBLIC_DIR)) {
    sendJson(res, 404, { error: 'Build not found. Run npm run build or use npm run dev.' });
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = resolve(PUBLIC_ROOT, rawPath.replace(/^\/+/, ''));
  const fallbackPath = join(PUBLIC_DIR, 'index.html');
  const isPublicFile = filePath === PUBLIC_ROOT || filePath.startsWith(`${PUBLIC_ROOT}${sep}`);
  const target = isPublicFile && existsSync(filePath) && statSync(filePath).isFile() ? filePath : fallbackPath;
  res.writeHead(200, {
    'content-type': mime[extname(target)] || 'application/octet-stream',
    'content-security-policy': "default-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  createReadStream(target).pipe(res);
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

function requireAuth(req) {
  if (!API_TOKEN) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return req.headers['x-at-token'] === API_TOKEN || bearer === API_TOKEN || url.searchParams.get('token') === API_TOKEN;
}

function requireHookAuth(req) {
  if (!HOOK_TOKEN) return requireAuth(req);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return req.headers['x-at-hook-token'] === HOOK_TOKEN || bearer === HOOK_TOKEN || url.searchParams.get('hookToken') === HOOK_TOKEN;
}

function route(method, pattern, handler) {
  return { method, pattern, handler };
}

function matchRoute(method, path) {
  for (const candidate of apiRoutes) {
    if (candidate.method !== method) continue;
    if (typeof candidate.pattern === 'string' && candidate.pattern === path) return { route: candidate, params: {} };
    if (candidate.pattern instanceof RegExp) {
      const match = path.match(candidate.pattern);
      if (match) return { route: candidate, params: match.groups || match.slice(1) };
    }
  }
  return null;
}

function sendRunEvents(req, res, url, runId) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': CORS_ORIGIN
  });
  let lastId = Number(url.searchParams.get('after') || 0);
  const send = (event) => {
    if (event.run_id !== runId || event.id <= lastId) return;
    lastId = event.id;
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const cleanup = () => {
    clearInterval(heartbeat);
    runtime.events.off('event', send);
  };
  const heartbeat = setInterval(() => {
    if (res.destroyed || req.destroyed) {
      cleanup();
      return;
    }
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 25_000);
  for (const event of runtime.storage.listEvents({ runId, afterId: lastId })) send(event);
  runtime.events.on('event', send);
  req.once('close', cleanup);
  req.once('aborted', cleanup);
  res.once('error', cleanup);
  res.once('finish', cleanup);
}

const apiRoutes = [
  route('GET', '/api/status', async ({ url }) => {
    const projectId = url.searchParams.get('projectId') || undefined;
    return { status: 200, body: await runtime.teamStatus(projectId) };
  }),
  route('GET', '/api/platform', async ({ url }) => {
    const projectId = url.searchParams.get('projectId') || undefined;
    return { status: 200, body: await runtime.platformHealth(projectId) };
  }),
  route('GET', '/api/platform/export', ({ url }) => {
    const projectId = url.searchParams.get('projectId') || undefined;
    return {
      status: 200,
      body: runtime.platformExport(projectId),
      headers: { 'content-disposition': 'attachment; filename="at-platform-export.json"' }
    };
  }),
  route('GET', '/api/openapi.json', () => ({ status: 200, body: openApiSpec })),
  route('GET', '/api/adapters', () => ({ status: 200, body: { adapters: runtime.adapters() } })),
  route('GET', '/api/chat', ({ url }) => {
    const projectId = url.searchParams.get('projectId') || undefined;
    return { status: 200, body: runtime.chatRoom(projectId) };
  }),
  route('POST', '/api/chat/messages', async ({ req }) => {
    const body = await readBody(req);
    return {
      status: 202,
      body: runtime.postChatMessage({
        projectId: body.projectId,
        title: body.title,
        content: body.content || body.prompt || '',
        permissionProfile: body.permissionProfile
      })
    };
  }),
  route('GET', '/api/work-items', ({ url }) => {
    const projectId = url.searchParams.get('projectId') || undefined;
    return { status: 200, body: runtime.listWorkItems(projectId) };
  }),
  route('POST', '/api/work-items', async ({ req }) => {
    const body = await readBody(req);
    return {
      status: 201,
      body: {
        workItem: runtime.createWorkItem(body),
        work: runtime.listWorkItems(body.projectId)
      }
    };
  }),
  route('POST', '/api/hooks/events', async ({ req }) => {
    const body = await readBody(req);
    return { status: 202, body: runtime.ingestDeveloperEvent(body) };
  }),
  route('GET', /^\/api\/work-items\/(?<id>[^/]+)\/activity$/, ({ url, params }) => {
    return { status: 200, body: runtime.getWorkItemActivity({ projectId: url.searchParams.get('projectId'), id: params.id }) };
  }),
  route('POST', /^\/api\/work-items\/(?<id>[^/]+)\/dispatch$/, async ({ req, params }) => {
    const body = await readBody(req);
    return {
      status: 202,
      body: runtime.dispatchWorkItem({
        projectId: body.projectId,
        id: params.id,
        prompt: body.prompt,
        permissionProfile: body.permissionProfile
      })
    };
  }),
  route('POST', /^\/api\/work-items\/(?<id>[^/]+)$/, async ({ req, params }) => {
    const body = await readBody(req);
    return {
      status: 200,
      body: {
        workItem: runtime.updateWorkItem({
          projectId: body.projectId,
          id: params.id,
          ...body
        }),
        work: runtime.listWorkItems(body.projectId)
      }
    };
  }),
  route('GET', '/api/agents', ({ url }) => ({
    status: 200,
    body: { agents: runtime.storage.listAgents({ includeDisabled: url.searchParams.get('includeDisabled') === 'true' }) }
  })),
  route('POST', '/api/agents', async ({ req }) => {
    const body = await readBody(req);
    return { status: 201, body: { agent: runtime.createAgent(body), status: await runtime.teamStatus(body.projectId) } };
  }),
  route('DELETE', /^\/api\/agents\/(?<roleId>[^/]+)$/, async ({ params }) => ({
    status: 200,
    body: { agent: runtime.disableAgent({ roleId: params.roleId }), status: await runtime.teamStatus() }
  })),
  route('POST', /^\/api\/agents\/(?<roleId>[^/]+)\/message$/, async ({ req, params }) => {
    const body = await readBody(req);
    return {
      status: 200,
      body: {
        result: await runtime.sendAgentMessage({
          projectId: body.projectId,
          roleId: params.roleId,
          content: body.content,
          permissionProfile: body.permissionProfile
        })
      }
    };
  }),
  route('POST', /^\/api\/agents\/(?<roleId>[^/]+)\/permissions$/, async ({ req, params }) => {
    const body = await readBody(req);
    return {
      status: 200,
      body: {
        session: runtime.setPermission({
          projectId: body.projectId,
          roleId: params.roleId,
          permissionProfile: body.permissionProfile
        })
      }
    };
  }),
  route('POST', /^\/api\/agents\/(?<roleId>[^/]+)\/config$/, async ({ req, params }) => {
    const body = await readBody(req);
    return { status: 200, body: { agent: runtime.updateAgentConfig({ roleId: params.roleId, config: body }) } };
  }),
  route('GET', /^\/api\/agents\/(?<roleId>[^/]+)\/memory$/, ({ url, params }) => ({
    status: 200,
    body: runtime.getMemory({ projectId: url.searchParams.get('projectId'), roleId: params.roleId })
  })),
  route('GET', '/api/projects', () => ({ status: 200, body: { projects: runtime.storage.listProjects() } })),
  route('POST', '/api/projects', async ({ req }) => {
    const body = await readBody(req);
    return { status: 201, body: { project: runtime.createProject(body) } };
  }),
  route('GET', /^\/api\/projects\/(?<projectId>[^/]+)\/team$/, async ({ params }) => ({
    status: 200,
    body: await runtime.teamStatus(params.projectId)
  })),
  route('POST', '/api/team/config', async ({ req }) => {
    const body = await readBody(req);
    const result = runtime.updateTeamConfig({ roleIds: body.roleIds, config: body.config || body });
    return { status: 200, body: { result, status: await runtime.teamStatus(body.projectId) } };
  }),
  route('POST', '/api/team/manifest', async ({ req }) => {
    const body = await readBody(req);
    return { status: 200, body: runtime.applyTeamManifest({ projectId: body.projectId, manifest: body.manifest || body }) };
  }),
  route('POST', '/api/runs', async ({ req }) => {
    const body = await readBody(req);
    const run = runtime.startManagerTask(body);
    return { status: 202, body: { run, status: await runtime.teamStatus(run.project_id), accepted: true } };
  }),
  route('POST', /^\/api\/runs\/(?<runId>[^/]+)\/dispatch$/, async ({ req, params }) => {
    const body = await readBody(req);
    return {
      status: 202,
      body: {
        result: runtime.enqueueAgentDispatch({
          runId: params.runId,
          roleId: body.roleId,
          task: body.task,
          permissionProfile: body.permissionProfile
        })
      }
    };
  }),
  route('GET', /^\/api\/runs\/(?<runId>[^/]+)\/events$/, ({ req, res, url, params }) => {
    sendRunEvents(req, res, url, params.runId);
    return { streamed: true };
  })
];

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    sendJson(res, 200, {});
    return true;
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    sendJson(res, 429, { error: 'Rate limit exceeded' });
    return true;
  }

  if (path === '/api/hooks/events' ? !requireHookAuth(req) : !requireAuth(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return true;
  }

  try {
    const matched = matchRoute(req.method, path);
    if (matched) {
      const result = await matched.route.handler({ req, res, url, params: matched.params });
      if (!result?.streamed) sendJson(res, result?.status || 200, result?.body ?? {}, result?.headers);
      return true;
    }

    if (req.method === 'GET' && path === '/api/status') {
      const projectId = url.searchParams.get('projectId') || undefined;
      sendJson(res, 200, await runtime.teamStatus(projectId));
      return true;
    }

    if (req.method === 'GET' && path === '/api/platform') {
      const projectId = url.searchParams.get('projectId') || undefined;
      sendJson(res, 200, await runtime.platformHealth(projectId));
      return true;
    }

    if (req.method === 'GET' && path === '/api/platform/export') {
      const projectId = url.searchParams.get('projectId') || undefined;
      sendJson(res, 200, runtime.platformExport(projectId), {
        'content-disposition': 'attachment; filename="at-platform-export.json"'
      });
      return true;
    }

    if (req.method === 'GET' && path === '/api/adapters') {
      sendJson(res, 200, { adapters: runtime.adapters() });
      return true;
    }

    if (req.method === 'GET' && path === '/api/chat') {
      const projectId = url.searchParams.get('projectId') || undefined;
      sendJson(res, 200, runtime.chatRoom(projectId));
      return true;
    }

    if (req.method === 'GET' && path === '/api/work-items') {
      const projectId = url.searchParams.get('projectId') || undefined;
      sendJson(res, 200, runtime.listWorkItems(projectId));
      return true;
    }

    if (req.method === 'POST' && path === '/api/work-items') {
      const body = await readBody(req);
      sendJson(res, 201, {
        workItem: runtime.createWorkItem(body),
        work: runtime.listWorkItems(body.projectId)
      });
      return true;
    }

    const workItemMatch = path.match(/^\/api\/work-items\/([^/]+)$/);
    if (req.method === 'POST' && workItemMatch) {
      const body = await readBody(req);
      sendJson(res, 200, {
        workItem: runtime.updateWorkItem({
          projectId: body.projectId,
          id: workItemMatch[1],
          ...body
        }),
        work: runtime.listWorkItems(body.projectId)
      });
      return true;
    }

    if (req.method === 'POST' && path === '/api/chat/messages') {
      const body = await readBody(req);
      sendJson(res, 202, runtime.postChatMessage({
        projectId: body.projectId,
        title: body.title,
        content: body.content || body.prompt || '',
        permissionProfile: body.permissionProfile
      }));
      return true;
    }

    if (req.method === 'GET' && path === '/api/agents') {
      sendJson(res, 200, {
        agents: runtime.storage.listAgents({ includeDisabled: url.searchParams.get('includeDisabled') === 'true' })
      });
      return true;
    }

    if (req.method === 'GET' && path === '/api/projects') {
      sendJson(res, 200, { projects: runtime.storage.listProjects() });
      return true;
    }

    if (req.method === 'POST' && path === '/api/projects') {
      const body = await readBody(req);
      sendJson(res, 201, { project: runtime.createProject(body) });
      return true;
    }

    if (req.method === 'POST' && path === '/api/agents') {
      const body = await readBody(req);
      sendJson(res, 201, {
        agent: runtime.createAgent(body),
        status: await runtime.teamStatus(body.projectId)
      });
      return true;
    }

    if (req.method === 'POST' && path === '/api/team/config') {
      const body = await readBody(req);
      const result = runtime.updateTeamConfig({
        roleIds: body.roleIds,
        config: body.config || body
      });
      sendJson(res, 200, {
        result,
        status: await runtime.teamStatus(body.projectId)
      });
      return true;
    }

    const teamMatch = path.match(/^\/api\/projects\/([^/]+)\/team$/);
    if (req.method === 'GET' && teamMatch) {
      sendJson(res, 200, await runtime.teamStatus(teamMatch[1]));
      return true;
    }

    if (req.method === 'POST' && path === '/api/runs') {
      const body = await readBody(req);
      const run = runtime.startManagerTask(body);
      sendJson(res, 202, { run, status: await runtime.teamStatus(run.project_id), accepted: true });
      return true;
    }

    const dispatchMatch = path.match(/^\/api\/runs\/([^/]+)\/dispatch$/);
    if (req.method === 'POST' && dispatchMatch) {
      const body = await readBody(req);
      const result = runtime.enqueueAgentDispatch({
        runId: dispatchMatch[1],
        roleId: body.roleId,
        task: body.task,
        permissionProfile: body.permissionProfile
      });
      sendJson(res, 202, { result });
      return true;
    }

    const eventMatch = path.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (req.method === 'GET' && eventMatch) {
      const runId = eventMatch[1];
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': CORS_ORIGIN
      });
      let lastId = Number(url.searchParams.get('after') || 0);
      const send = (event) => {
        if (event.run_id !== runId || event.id <= lastId) return;
        lastId = event.id;
        res.write(`id: ${event.id}\n`);
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const cleanup = () => {
        clearInterval(heartbeat);
        runtime.events.off('event', send);
      };
      const heartbeat = setInterval(() => {
        if (res.destroyed || req.destroyed) {
          cleanup();
          return;
        }
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 25_000);
      for (const event of runtime.storage.listEvents({ runId, afterId: lastId })) send(event);
      runtime.events.on('event', send);
      req.once('close', cleanup);
      req.once('aborted', cleanup);
      res.once('error', cleanup);
      res.once('finish', cleanup);
      return true;
    }

    const messageMatch = path.match(/^\/api\/agents\/([^/]+)\/message$/);
    if (req.method === 'POST' && messageMatch) {
      const body = await readBody(req);
      const result = await runtime.sendAgentMessage({
        projectId: body.projectId,
        roleId: messageMatch[1],
        content: body.content,
        permissionProfile: body.permissionProfile
      });
      sendJson(res, 200, { result });
      return true;
    }

    const permissionMatch = path.match(/^\/api\/agents\/([^/]+)\/permissions$/);
    if (req.method === 'POST' && permissionMatch) {
      const body = await readBody(req);
      sendJson(res, 200, {
        session: runtime.setPermission({
          projectId: body.projectId,
          roleId: permissionMatch[1],
          permissionProfile: body.permissionProfile
        })
      });
      return true;
    }

    const configMatch = path.match(/^\/api\/agents\/([^/]+)\/config$/);
    if (req.method === 'POST' && configMatch) {
      const body = await readBody(req);
      sendJson(res, 200, {
        agent: runtime.updateAgentConfig({
          roleId: configMatch[1],
          config: body
        })
      });
      return true;
    }

    const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
    if (req.method === 'DELETE' && agentMatch) {
      sendJson(res, 200, {
        agent: runtime.disableAgent({ roleId: agentMatch[1] }),
        status: await runtime.teamStatus()
      });
      return true;
    }

    const memoryMatch = path.match(/^\/api\/agents\/([^/]+)\/memory$/);
    if (req.method === 'GET' && memoryMatch) {
      sendJson(res, 200, runtime.getMemory({ projectId: url.searchParams.get('projectId'), roleId: memoryMatch[1] }));
      return true;
    }
  } catch (error) {
    const status = error instanceof SyntaxError || isClientError(error) ? 400 : 500;
    const body = { error: status === 500 ? 'Internal server error' : error.message };
    sendJson(res, status, body);
    return true;
  }

  return false;
}

const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    const handled = await handleApi(req, res);
    if (!handled) sendJson(res, 404, { error: 'Not found' });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  runtime.ensureTeam(runtime.storage.ensureDefaultProject().id);
  console.log(`AT Agent Team API listening on http://127.0.0.1:${PORT}`);
});
