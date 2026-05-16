import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/apiClient.js';

test('api client retries transient fetch failures before succeeding', async () => {
  let calls = 0;
  const client = createApiClient({
    baseUrl: 'http://at.test',
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'http://at.test/api/status');
      assert.equal(options.headers['content-type'], 'application/json');
      if (calls < 3) throw new Error('temporary network failure');
      return {
        ok: true,
        json: async () => ({ ok: true, calls })
      };
    }
  });

  const result = await client.api('/api/status', { retryDelayMs: 0 });
  assert.deepEqual(result, { ok: true, calls: 3 });
  assert.equal(calls, 3);
});

test('api client does not retry Unauthorized responses', async () => {
  let calls = 0;
  const client = createApiClient({
    baseUrl: 'http://at.test',
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Unauthorized' })
      };
    }
  });

  await assert.rejects(() => client.api('/api/status', { retryDelayMs: 0 }), /Unauthorized/);
  assert.equal(calls, 1);
});
