import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { waitForAiServer } from '../scripts/wait-for-ai-server.mjs';

test('waits for the AI Server health endpoint before resolving', async (t) => {
  let ready = false;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');

    if (request.url === '/api/health' && ready) {
      response.writeHead(200);
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    response.writeHead(503);
    response.end(JSON.stringify({ status: 'starting' }));
  });

  await new Promise((resolveListening) => server.listen(0, resolveListening));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const startedAt = Date.now();
  const waiting = waitForAiServer({
    baseUrl: `http://127.0.0.1:${address.port}`,
    timeoutMs: 1_000,
    pollIntervalMs: 20,
    requestTimeoutMs: 100,
  });

  await delay(100);
  ready = true;

  const healthUrl = await waiting;
  assert.equal(healthUrl, `http://127.0.0.1:${address.port}/api/health`);
  assert.ok(Date.now() - startedAt >= 100);
});
