#!/usr/bin/env node
// Run from a project that has `at-group-chat` installed, or copy this file after `npm install at-group-chat`.
import { createATClient } from 'at-group-chat/sdk';

const content = process.argv.slice(2).join(' ').trim()
  || '请作为 AT manager 阅读当前 room，创建必要 work item，并决定是否需要点名一个 agent。';

const at = createATClient({
  baseUrl: process.env.AT_TEAM_API_BASE_URL || 'http://127.0.0.1:5174',
  token: process.env.AT_TEAM_API_TOKEN || ''
});

try {
  const room = await at.room();
  const result = await at.chat({
    title: 'External SDK manager request',
    content: [
      'External manager request:',
      content,
      '',
      `Current AT room has ${room.participants?.length || 0} participants and ${room.workItems?.length || 0} work items.`,
      '',
      'Manager decision must include current state, next agent, reason, permission, and stop condition.'
    ].join('\n'),
    permissionProfile: 'write-proposed'
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`AT SDK example failed: ${error.message}`);
  console.error('Check that the AT runtime is running and AT_TEAM_API_BASE_URL / AT_TEAM_API_TOKEN are set.');
  process.exit(1);
}
