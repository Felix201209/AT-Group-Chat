import { runtime } from './singleton.js';

const tools = [
  {
    name: 'team_create_task',
    description: 'Create a manager-controlled team task. The codex-manager agent replies first.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        prompt: { type: 'string' },
        permissionProfile: { type: 'string' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'team_chat_message',
    description: 'Post a human/manager message into the AT AI group chat. This creates a manager-controlled run and queues codex-manager.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        permissionProfile: { type: 'string' }
      },
      required: ['content']
    }
  },
  {
    name: 'team_get_room',
    description: 'Get the AT AI group chat room, participants, persisted room messages, and recent events.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } }
    }
  },
  {
    name: 'team_get_work_items',
    description: 'Get AT work items: issues, proposals, reviews, decisions, and artifacts for the current project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } }
    }
  },
  {
    name: 'team_create_work_item',
    description: 'Create an AT issue/proposal/review/decision/artifact. Optionally dispatch it to manager immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        type: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        priority: { type: 'string' },
        assignedRoleId: { type: 'string' },
        parentId: { type: 'string' },
        dispatchToManager: { type: 'boolean' },
        permissionProfile: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'team_update_work_item',
    description: 'Update an AT work item status, owner, title, body, priority, linked run, parent, or metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        id: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'string' },
        assignedRoleId: { type: 'string' },
        linkedRunId: { type: 'string' },
        parentId: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'team_get_work_item_activity',
    description: 'Get a work item activity thread with related runs, messages, events, and child review/decision/artifact items.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        id: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'team_dispatch_work_item',
    description: 'Dispatch a work item to the manager as a manager-controlled run and link the resulting run back to the work item.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        id: { type: 'string' },
        prompt: { type: 'string' },
        permissionProfile: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'team_dispatch_agent',
    description: 'Dispatch one specific agent inside an existing manager-created run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        roleId: { type: 'string' },
        task: { type: 'string' },
        permissionProfile: { type: 'string' }
      },
      required: ['runId', 'roleId', 'task']
    }
  },
  {
    name: 'team_get_status',
    description: 'Get projects, agents, runs, permissions, sessions, and recent team events.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } }
    }
  },
  {
    name: 'team_export_platform',
    description: 'Export a portable AT platform snapshot with project, agents, sessions, runs, events, adapters, and platform metadata.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } }
    }
  },
  {
    name: 'team_get_memory',
    description: 'Get a role memory thread and shared team transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        roleId: { type: 'string' }
      },
      required: ['roleId']
    }
  },
  {
    name: 'team_set_permission',
    description: 'Set a role permission profile for future manager dispatches.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        roleId: { type: 'string' },
        permissionProfile: { type: 'string' }
      },
      required: ['roleId', 'permissionProfile']
    }
  },
  {
    name: 'team_configure_agent',
    description: 'Create or update an agent role, model, adapter, command, and generic CLI command template.',
    inputSchema: {
      type: 'object',
      properties: {
        roleId: { type: 'string' },
        name: { type: 'string' },
        cli: { type: 'string' },
        adapter: { type: 'string' },
        command: { type: 'string' },
        commandTemplate: { type: 'string' },
        model: { type: 'string' },
        thinkingLevel: { type: 'string' },
        responsibility: { type: 'string' },
        defaultPermission: { type: 'string' }
      },
      required: ['roleId']
    }
  },
  {
    name: 'team_configure_defaults',
    description: 'Apply model, thinking level, default permission, adapter, command, or command template defaults to multiple active agents.',
    inputSchema: {
      type: 'object',
      properties: {
        roleIds: { type: 'array', items: { type: 'string' } },
        model: { type: 'string' },
        thinkingLevel: { type: 'string' },
        defaultPermission: { type: 'string' },
        adapter: { type: 'string' },
        command: { type: 'string' },
        commandTemplate: { type: 'string' }
      }
    }
  },
  {
    name: 'team_disable_agent',
    description: 'Disable an agent role without deleting its memory. codex-manager cannot be disabled.',
    inputSchema: {
      type: 'object',
      properties: {
        roleId: { type: 'string' }
      },
      required: ['roleId']
    }
  }
];

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id, error) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } })}\n`);
}

async function callTool(name, args = {}) {
  if (name === 'team_create_task') {
    const run = await runtime.runManagerTask(args);
    return { content: [{ type: 'text', text: JSON.stringify({ run, status: await runtime.teamStatus(run.project_id) }, null, 2) }] };
  }
  if (name === 'team_chat_message') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.postChatMessage(args), null, 2) }] };
  }
  if (name === 'team_get_room') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.chatRoom(args.projectId), null, 2) }] };
  }
  if (name === 'team_get_work_items') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.listWorkItems(args.projectId), null, 2) }] };
  }
  if (name === 'team_create_work_item') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.createWorkItem(args), null, 2) }] };
  }
  if (name === 'team_update_work_item') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.updateWorkItem(args), null, 2) }] };
  }
  if (name === 'team_get_work_item_activity') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.getWorkItemActivity(args), null, 2) }] };
  }
  if (name === 'team_dispatch_work_item') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.dispatchWorkItem(args), null, 2) }] };
  }
  if (name === 'team_dispatch_agent') {
    const result = await runtime.dispatchAgent(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
  if (name === 'team_get_status') {
    return { content: [{ type: 'text', text: JSON.stringify(await runtime.teamStatus(args.projectId), null, 2) }] };
  }
  if (name === 'team_export_platform') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.platformExport(args.projectId), null, 2) }] };
  }
  if (name === 'team_get_memory') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.getMemory(args), null, 2) }] };
  }
  if (name === 'team_set_permission') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.setPermission(args), null, 2) }] };
  }
  if (name === 'team_configure_agent') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.createAgent(args), null, 2) }] };
  }
  if (name === 'team_configure_defaults') {
    const { roleIds, ...config } = args;
    return { content: [{ type: 'text', text: JSON.stringify(runtime.updateTeamConfig({ roleIds, config }), null, 2) }] };
  }
  if (name === 'team_disable_agent') {
    return { content: [{ type: 'text', text: JSON.stringify(runtime.disableAgent(args), null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

let buffer = '';
process.stdin.on('data', async (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
      if (request.method === 'initialize') {
        respond(request.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'at-agent-team', version: '1.0.0' }
        });
      } else if (request.method === 'tools/list') {
        respond(request.id, { tools });
      } else if (request.method === 'tools/call') {
        respond(request.id, await callTool(request.params.name, request.params.arguments));
      } else if (request.method === 'notifications/initialized') {
        // Notification: no response.
      } else {
        respond(request.id, {});
      }
    } catch (error) {
      fail(request?.id ?? null, error);
    }
  }
});
