export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'AT Group Chat Local API',
    version: '1.1.0',
    description: 'Local manager-controlled AI agent team API for chat, work items, runs, agents, memory, and platform export.'
  },
  servers: [
    { url: 'http://127.0.0.1:5174', description: 'Default local AT runtime' }
  ],
  components: {
    securitySchemes: {
      atToken: {
        type: 'apiKey',
        in: 'header',
        name: 'x-at-token',
        description: 'Required when AT_TEAM_API_TOKEN is configured.'
      },
      bearerToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'Alternative token transport when AT_TEAM_API_TOKEN is configured.'
      },
      hookToken: {
        type: 'apiKey',
        in: 'header',
        name: 'x-at-hook-token',
        description: 'Preferred token for /api/hooks/events when AT_TEAM_HOOK_TOKEN is configured.'
      }
    },
    schemas: {
      PermissionProfile: {
        type: 'string',
        enum: ['readonly', 'write-proposed', 'workspace-write', 'danger']
      },
      WorkItemType: {
        type: 'string',
        enum: ['issue', 'proposal', 'review', 'decision', 'artifact']
      },
      WorkItemStatus: {
        type: 'string',
        enum: ['open', 'in-progress', 'review', 'accepted', 'closed']
      },
      ThinkingLevel: {
        type: 'string',
        enum: ['default', 'minimal', 'low', 'medium', 'high', 'xhigh']
      }
    }
  },
  security: [{ atToken: [] }, { bearerToken: [] }, {}],
  paths: {
    '/api/status': {
      get: {
        summary: 'Get team status',
        parameters: [{ name: 'projectId', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Current project, agents, runs, sessions, and events.' } }
      }
    },
    '/api/platform': {
      get: {
        summary: 'Get setup readiness, security, adapters, and runtime counters',
        responses: { 200: { description: 'Platform health and setup checklist.' } }
      }
    },
    '/api/openapi.json': {
      get: {
        summary: 'Get this OpenAPI contract',
        responses: { 200: { description: 'OpenAPI 3.1 JSON document.' } }
      }
    },
    '/api/chat': {
      get: {
        summary: 'Get group chat room',
        responses: { 200: { description: 'Room, participants, messages, work items, and recent events.' } }
      }
    },
    '/api/chat/messages': {
      post: {
        summary: 'Post a message into the AT group chat and queue manager',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  projectId: { type: 'string' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                  permissionProfile: { $ref: '#/components/schemas/PermissionProfile' }
                }
              }
            }
          }
        },
        responses: { 202: { description: 'Run accepted; codex-manager is queued.' } }
      }
    },
    '/api/work-items': {
      get: {
        summary: 'List work items',
        responses: { 200: { description: 'Issues, proposals, reviews, decisions, and artifacts.' } }
      },
      post: {
        summary: 'Create a work item, optionally dispatching it to manager',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  projectId: { type: 'string' },
                  type: { $ref: '#/components/schemas/WorkItemType' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                  assignedRoleId: { type: 'string' },
                  parentId: { type: 'string' },
                  dispatchToManager: { type: 'boolean' },
                  permissionProfile: { $ref: '#/components/schemas/PermissionProfile' }
                }
              }
            }
          }
        },
        responses: { 201: { description: 'Created work item.' } }
      }
    },
    '/api/hooks/events': {
      post: {
        summary: 'Ingest a developer event as an AT work item',
        description: 'Local webhook/CI bridge for GitHub Actions, lint, test, review, or external-agent events. It can optionally dispatch manager, but never starts free agent loops.',
        security: [{ hookToken: [] }, { bearerToken: [] }, {}],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                    properties: {
                      dedupeKey: { type: 'string' },
                      idempotencyKey: { type: 'string' },
                      manifestKey: { type: 'string' },
                      projectId: { type: 'string' },
                  source: { type: 'string' },
                  event: { type: 'string' },
                  type: { $ref: '#/components/schemas/WorkItemType' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                  assignedRoleId: { type: 'string' },
                  metadata: { type: 'object' },
                  dispatchToManager: { type: 'boolean' },
                  permissionProfile: { $ref: '#/components/schemas/PermissionProfile' }
                }
              }
            }
          }
        },
        responses: { 202: { description: 'Developer event accepted.' } }
      }
    },
    '/api/work-items/{id}/activity': {
      get: {
        summary: 'Get work item activity thread',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Related items, runs, messages, and events.' } }
      }
    },
    '/api/work-items/{id}/dispatch': {
      post: {
        summary: 'Dispatch a work item to manager',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 202: { description: 'Manager-controlled run linked back to work item.' } }
      }
    },
    '/api/work-items/{id}': {
      post: {
        summary: 'Update a work item',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  type: { $ref: '#/components/schemas/WorkItemType' },
                  status: { $ref: '#/components/schemas/WorkItemStatus' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                  assignedRoleId: { type: 'string' },
                  linkedRunId: { type: 'string' },
                  parentId: { type: 'string' },
                  metadata: { type: 'object' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Updated work item and current board.' } }
      }
    },
    '/api/runs': {
      post: {
        summary: 'Create a manager-controlled run directly',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompt'],
                properties: {
                  projectId: { type: 'string' },
                  title: { type: 'string' },
                  prompt: { type: 'string' },
                  permissionProfile: { $ref: '#/components/schemas/PermissionProfile' }
                }
              }
            }
          }
        },
        responses: { 202: { description: 'Run accepted; manager queued.' } }
      }
    },
    '/api/team/manifest': {
      post: {
        summary: 'Apply an AT team manifest',
        description: 'Repo-style Team as Code entry point. Configure defaults, agents, and seed work items from one JSON object. Repeated applies converge work items through manifestKey metadata.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string' },
                  manifest: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      version: { type: 'string' },
                      defaults: { type: 'object' },
                      agents: { type: 'array', items: { type: 'object' } },
                      workItems: { type: 'array', items: { type: 'object' } }
                    }
                  }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Manifest applied and current status returned.' } }
      }
    },
    '/api/runs/{runId}/dispatch': {
      post: {
        summary: 'Dispatch one agent inside an existing manager-created run',
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 202: { description: 'Agent queued. No automatic follow-up is triggered.' } }
      }
    },
    '/api/runs/{runId}/events': {
      get: {
        summary: 'Stream run events via SSE',
        parameters: [
          { name: 'runId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'after', in: 'query', schema: { type: 'integer' } }
        ],
        responses: { 200: { description: 'SSE stream of run.created, agent.started, output, completion, failures, and approval events.' } }
      }
    },
    '/api/agents': {
      get: {
        summary: 'List agent definitions',
        responses: { 200: { description: 'Enabled or all configured agents.' } }
      },
      post: {
        summary: 'Create or update a custom agent',
        responses: { 201: { description: 'Agent configured.' } }
      }
    },
    '/api/agents/{roleId}/config': {
      post: {
        summary: 'Configure one agent role, adapter, model, command, and responsibility',
        parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Updated agent config.' } }
      }
    },
    '/api/agents/{roleId}/message': {
      post: {
        summary: 'Append a message to one role through manager-controlled runtime',
        parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  projectId: { type: 'string' },
                  content: { type: 'string' },
                  permissionProfile: { $ref: '#/components/schemas/PermissionProfile' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Agent message accepted or dispatched through manager rules.' } }
      }
    },
    '/api/agents/{roleId}/permissions': {
      post: {
        summary: 'Set one agent permission profile',
        parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['permissionProfile'],
                properties: {
                  projectId: { type: 'string' },
                  permissionProfile: { $ref: '#/components/schemas/PermissionProfile' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Updated role session permission.' } }
      }
    },
    '/api/agents/{roleId}/memory': {
      get: {
        summary: 'Get one role memory and shared transcript',
        parameters: [
          { name: 'roleId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'Role session, messages, and shared transcript.' } }
      }
    },
    '/api/team/config': {
      post: {
        summary: 'Apply model, thinking, adapter, command, or permission defaults across active agents',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string' },
                  roleIds: { type: 'array', items: { type: 'string' } },
                  config: { type: 'object' },
                  model: { type: 'string' },
                  thinkingLevel: { $ref: '#/components/schemas/ThinkingLevel' },
                  defaultPermission: { $ref: '#/components/schemas/PermissionProfile' },
                  adapter: { type: 'string' },
                  command: { type: 'string' },
                  commandTemplate: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Updated team defaults and current status.' } }
      }
    },
    '/api/platform/export': {
      get: {
        summary: 'Export portable platform state',
        responses: { 200: { description: 'Portable local snapshot for audit, migration, and handoff.' } }
      }
    }
  }
};
