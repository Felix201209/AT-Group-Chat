import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { invokeCodexViaAppServer } from './codexAppServerClient.js';

function permissionArgs(role, permissionProfile) {
  if (role.cli === 'claude') {
    if (permissionProfile === 'danger') return ['--permission-mode', 'bypassPermissions'];
    if (permissionProfile === 'workspace-write') return ['--permission-mode', 'acceptEdits'];
    return ['--permission-mode', 'plan'];
  }
  if (role.cli === 'kimi') {
    if (permissionProfile === 'danger' || permissionProfile === 'workspace-write') return ['--yolo'];
    if (permissionProfile === 'readonly' || permissionProfile === 'write-proposed') return ['--plan'];
  }
  return [];
}

function extractSessionId(output) {
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const item = JSON.parse(line);
      const candidates = [
        item.session_id,
        item.sessionId,
        item.thread_id,
        item.threadId,
        item.conversation_id,
        item.conversationId,
        item.id
      ];
      const hit = candidates.find((value) => typeof value === 'string' && value.length > 12);
      if (hit) return hit;
    } catch {
      // Ignore non-event JSON.
    }
  }
  return null;
}

function runProcess(command, args, input, { cwd, timeoutMs = 180000, env = process.env }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stderr += `\nTimed out after ${timeoutMs}ms`;
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${error.message}`, code: 1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code });
    });

    child.stdin.on('error', (error) => {
      stderr += `\nstdin error: ${error.message}`;
    });
    const flushed = child.stdin.write(input);
    if (flushed) child.stdin.end();
    else child.stdin.once('drain', () => child.stdin.end());
  });
}

export function buildCommand({ role, projectPath, session, prompt, permissionProfile }) {
  if (role.adapter === 'generic-cli' || role.cli === 'generic') {
    const template = role.commandTemplate || role.command;
    if (!template) throw new Error(`Generic CLI role ${role.id} requires commandTemplate or command`);
    return {
      command: process.env.SHELL || 'zsh',
      args: ['-lc', template]
    };
  }

  if (role.cli === 'codex') {
    throw new Error('Codex roles use codex app-server; process command builder is only for non-Codex CLI adapters');
  }

  if (role.cli === 'claude') {
    const base = [
      '-p',
      '--model',
      role.model,
      '--session-id',
      session.native_session_id,
      '--output-format',
      'json'
    ];
    return {
      command: role.command || 'claude',
      args: [...base, ...permissionArgs(role, permissionProfile), prompt]
    };
  }

  if (role.cli === 'kimi') {
    return {
      command: role.command || 'kimi',
      args: [
        '--work-dir',
        projectPath,
        '--session',
        session.native_session_id,
        '--print',
        '--output-format',
        'text',
        ...permissionArgs(role, permissionProfile),
        '--prompt',
        prompt
      ]
    };
  }

  throw new Error(`Unsupported CLI: ${role.cli}`);
}

export async function invokeAgent({
  role,
  project,
  session,
  prompt,
  permissionProfile,
  mode = 'real',
  onEvent
}) {
  const useCodexAppServer = role.cli === 'codex' && !['generic-cli'].includes(role.adapter);
  if (useCodexAppServer) {
    if (mode === 'real') return invokeCodexViaAppServer({ role, project, session, prompt, permissionProfile, onEvent });
    return {
      ok: true,
      command: `codex app-server mock thread=${session.native_session_id}`,
      output: [
        `[mock:${role.id}] 已接收 manager 分派。`,
        `权限: ${permissionProfile}`,
        `思考强度: ${role.thinkingLevel || 'medium'}`,
        `记忆会话: ${session.native_session_id}`,
        `回复: 我已阅读 team transcript，并只针对本次 manager 调度给出岗位结论。`
      ].join('\n'),
      nativeSessionId: session.native_session_id,
      code: 0,
      stderr: '',
      transport: 'codex-app-server',
      autoResponses: []
    };
  }

  const commandSpec = buildCommand({
    role,
    projectPath: project.path,
    session,
    prompt,
    permissionProfile
  });

  if (mode !== 'real') {
    const autoResponses = [];
    if (role.adapter === 'event-test') {
      const autoResponse = { method: 'test/requestApproval', requestId: 'test-approval-1', autoResponse: 'decline' };
      autoResponses.push(autoResponse);
      onEvent?.({
        type: 'agent.approval.requested',
        payload: {
          method: autoResponse.method,
          requestId: autoResponse.requestId,
          permissionProfile,
          autoResponse: autoResponse.autoResponse
        }
      });
    }
    return {
      ok: true,
      command: [commandSpec.command, ...commandSpec.args].join(' '),
      output: [
        `[mock:${role.id}] 已接收 manager 分派。`,
        `权限: ${permissionProfile}`,
        `思考强度: ${role.thinkingLevel || 'medium'}`,
        `记忆会话: ${session.native_session_id}`,
        `回复: 我已阅读 team transcript，并只针对本次 manager 调度给出岗位结论。`
      ].join('\n'),
      nativeSessionId: session.native_session_id,
      code: 0,
      stderr: '',
      autoResponses
    };
  }

  const tmpRoot = join(tmpdir(), `at-team-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
  const promptPath = join(tmpRoot, 'prompt.txt');
  writeFileSync(promptPath, prompt);
  const args = commandSpec.args;

  const env = {
    ...process.env,
    AT_AGENT_ROLE_ID: role.id,
    AT_AGENT_NAME: role.name || role.id,
    AT_AGENT_MODEL: role.model || '',
    AT_AGENT_THINKING_LEVEL: role.thinkingLevel || 'medium',
    AT_AGENT_SESSION_ID: session.native_session_id,
    AT_AGENT_PROJECT_PATH: project.path,
    AT_AGENT_PERMISSION_PROFILE: permissionProfile,
    AT_AGENT_PROMPT_FILE: promptPath,
    AT_AGENT_PROMPT: prompt
  };
  const result = await runProcess(commandSpec.command, args, prompt, { cwd: project.path, env });
  let output = result.stdout || '';
  rmSync(tmpRoot, { recursive: true, force: true });

  return {
    ok: result.ok,
    command: [commandSpec.command, ...args].join(' '),
    output: output.trim() || result.stderr.trim(),
    nativeSessionId: extractSessionId(result.stdout) || session.native_session_id,
    code: result.code,
    stderr: result.stderr
  };
}

export function writeAgentSpec(path, role) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        id: role.id,
        name: role.name,
        responsibility: role.responsibility,
        thinkingLevel: role.thinkingLevel || 'medium',
        memory: 'project-role persistent session',
        loopPolicy: 'respond only when codex-manager dispatches'
      },
      null,
      2
    )
  );
}
