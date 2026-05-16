import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function request(child, payload) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === payload.id) {
          child.stdout.off('data', onData);
          resolve(message);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    setTimeout(() => reject(new Error(`Timed out waiting for ${payload.method}`)), 5000).unref();
  });
}

test('MCP tools expose the same runtime surface', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-team-mcp-'));
  const child = spawn('node', ['server/mcp.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AT_TEAM_DB_PATH: join(dir, 'mcp.sqlite'),
      AT_TEAM_AGENT_MODE: 'mock'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  try {
    const init = await request(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(init.result.serverInfo.name, 'at-agent-team');

    const list = await request(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_create_task'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_get_manager_contract'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_chat_message'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_get_room'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_get_work_items'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_create_work_item'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_update_work_item'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_get_work_item_activity'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_dispatch_work_item'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_dispatch_agent'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_export_platform'));
    assert.ok(list.result.tools.some((tool) => tool.name === 'team_configure_agent'));

    const contract = await request(child, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'team_get_manager_contract',
        arguments: { apiBaseUrl: 'http://127.0.0.1:5174' }
      }
    });
    const contractJson = JSON.parse(contract.result.content[0].text);
    assert.equal(contractJson.mode, 'manager-controlled');
    assert.equal(contractJson.http.getContract, 'GET /api/contract');
    assert.ok(contractJson.mcpTools.includes('team_get_manager_contract'));
    assert.ok(contractJson.prompt.includes('Manager decision'));

    const call = await request(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'team_get_status',
        arguments: {}
      }
    });
    assert.match(call.result.content[0].text, /codex-manager/);

    const room = await request(child, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'team_get_room',
        arguments: {}
      }
    });
    assert.match(room.result.content[0].text, /AT AI 合作群聊/);

    const work = await request(child, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'team_create_work_item',
        arguments: {
          type: 'proposal',
          title: 'MCP Work Board proposal',
          body: 'A proposal/PR object for agent collaboration.',
          assignedRoleId: 'kimi-ux-review'
        }
      }
    });
    const workItem = JSON.parse(work.result.content[0].text);
    assert.equal(workItem.type, 'proposal');
    assert.equal(workItem.assignedRoleId, 'kimi-ux-review');

    const workUpdated = await request(child, {
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'team_update_work_item',
        arguments: {
          id: workItem.id,
          status: 'review'
        }
      }
    });
    assert.match(workUpdated.result.content[0].text, /"status": "review"/);

    const workList = await request(child, {
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'team_get_work_items',
        arguments: {}
      }
    });
    assert.match(workList.result.content[0].text, /MCP Work Board proposal/);

    const dispatchedWork = await request(child, {
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: {
        name: 'team_dispatch_work_item',
        arguments: {
          id: workItem.id,
          permissionProfile: 'readonly'
        }
      }
    });
    const dispatchedPayload = JSON.parse(dispatchedWork.result.content[0].text);
    assert.equal(dispatchedPayload.item.linkedRunId, dispatchedPayload.run.id);

    const activity = await request(child, {
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        name: 'team_get_work_item_activity',
        arguments: { id: workItem.id }
      }
    });
    assert.match(activity.result.content[0].text, /work.item.dispatched/);
    assert.match(activity.result.content[0].text, /MCP Work Board proposal/);

    const exported = await request(child, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'team_export_platform',
        arguments: {}
      }
    });
    assert.match(exported.result.content[0].text, /at-agent-team-platform-export\/v1/);
    assert.match(exported.result.content[0].text, /"adapters"/);

    const chat = await request(child, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'team_chat_message',
        arguments: {
          content: 'MCP AT 群聊入口测试',
          permissionProfile: 'readonly'
        }
      }
    });
    assert.match(chat.result.content[0].text, /"accepted": true/);
    assert.match(chat.result.content[0].text, /\/api\/runs\/.+\/events/);

    const configured = await request(child, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'team_configure_agent',
        arguments: {
          roleId: 'local-extra',
          name: 'Local Extra',
          adapter: 'generic-cli',
          cli: 'generic',
          command: 'zsh',
          commandTemplate: 'cat "$AT_AGENT_PROMPT_FILE"',
          model: 'local-model',
          thinkingLevel: 'low',
          responsibility: 'MCP configured custom role.'
        }
      }
    });
    assert.match(configured.result.content[0].text, /local-extra/);
    assert.match(configured.result.content[0].text, /"thinking_level": "low"/);

    const defaults = await request(child, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'team_configure_defaults',
        arguments: {
          roleIds: ['local-extra'],
          model: 'bulk-model',
          thinkingLevel: 'medium',
          defaultPermission: 'write-proposed'
        }
      }
    });
    assert.match(defaults.result.content[0].text, /bulk-model/);
    assert.match(defaults.result.content[0].text, /write-proposed/);

    const disabled = await request(child, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'team_disable_agent',
        arguments: { roleId: 'local-extra' }
      }
    });
    assert.match(disabled.result.content[0].text, /"enabled": 0/);
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});
