#!/usr/bin/env node
// Run from a project that has `at-group-chat` installed, or copy this file after `npm install at-group-chat`.
import { createATClient } from 'at-group-chat/sdk';

const content = process.argv.slice(2).join(' ').trim()
  || '请作为 AT manager 阅读当前 room，创建必要 work item，并决定是否需要点名一个 agent。';
const maxEvents = Number(process.env.AT_EXAMPLE_MAX_EVENTS || '100');

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

  console.log(JSON.stringify({ type: 'chat.accepted', runId: result.run?.id, response: result }));
  if (!result.run?.id) throw new Error('AT accepted the task but did not return a run id.');

  let count = 0;
  for await (const event of at.runEvents(result.run.id)) {
    console.log(JSON.stringify(event));
    count += 1;
    if (event.type === 'agent.completed' || event.type === 'agent.failed' || event.type === 'run.failed') break;
    if (maxEvents && count >= maxEvents) {
      console.error(`AT SDK example reached AT_EXAMPLE_MAX_EVENTS=${maxEvents}; run may still be active.`);
      break;
    }
  }
} catch (error) {
  console.error(`AT SDK example failed: ${error.message}`);
  console.error('Check that the AT runtime is running and AT_TEAM_API_BASE_URL / AT_TEAM_API_TOKEN are set.');
  process.exit(1);
}
