import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { ChatController } from '../dist/chat/chat.controller.js';

class ResponseMock extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  status() { return this; }
  setHeader() {}
  flushHeaders() {}
  write() {}
  end() { this.writableEnded = true; }
  disconnect() { this.destroyed = true; this.emit('close'); }
}

test('disconnect during preparation disposes resources and never starts an agent', async () => {
  let finishPrepare;
  let closed = 0;
  let streamed = 0;
  const service = {
    prepare: () => new Promise(resolve => { finishPrepare = resolve; }),
    async *stream() { streamed++; },
  };
  const response = new ResponseMock();
  const pending = new ChatController(service).complete({}, response);
  response.disconnect();
  finishPrepare({ agentRuntime: { close: async () => { closed++; } } });
  await pending;
  assert.equal(streamed, 0);
  assert.equal(closed, 1);
  assert.equal(response.listenerCount('close'), 0);
});

test('disconnect during streaming aborts downstream work and cleans listeners', async () => {
  let downstreamSignal;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let cleaned = false;
  const service = {
    prepare: async () => ({ model: { model: 'mock' } }),
    async *stream(_prepared, signal) {
      downstreamSignal = signal; started();
      try { await sleep(60_000, undefined, { signal }); }
      finally { cleaned = true; }
    },
  };
  const response = new ResponseMock();
  const pending = new ChatController(service).complete({}, response);
  await ready;
  response.disconnect();
  await pending;
  assert.equal(downstreamSignal.aborted, true);
  assert.equal(cleaned, true);
  assert.equal(response.listenerCount('close'), 0);
});
