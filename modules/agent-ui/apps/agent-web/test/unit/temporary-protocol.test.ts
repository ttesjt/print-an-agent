import { expect, it } from 'vitest';
import { TemporaryStreamProtocol } from '../../src/temporary-conversation/protocol.js';
import { createHttpTemporaryConversationPort } from '../../src/transport/temporary-conversation/browser.js';
import type { TemporaryConversationEvent } from '../../src/temporary-conversation/contracts.js';

const request = {
  interactionId: 'send',
  agentId: 'demo',
  expectedConfigRevision: '1',
  message: 'hello',
  history: [],
};
const opened = { type: 'opened', interactionId: 'send' };
const completed = {
  type: 'completed',
  interactionId: 'send',
  configRevision: '1',
  assistant: {
    text: 'answer',
    timestamp: new Date(1).toISOString(),
    stopReason: 'stop',
    reasoningBlocks: [],
  },
};

it.each(
  [
    [completed],
    [opened, opened],
    [opened, { type: 'unknown', interactionId: 'send' }],
    [opened, { ...completed, interactionId: 'other' }],
    [opened, { ...completed, configRevision: '2' }],
    [opened, completed, completed],
    [opened, completed, { type: 'text-delta', interactionId: 'send', delta: 'late' }],
    [opened, { type: 'text-delta', interactionId: 'send', delta: 'different' }, completed],
    [opened, { type: 'reasoning-delta', interactionId: 'send', delta: 'missing' }, completed],
  ].map((events) => ({ events }))
)('rejects malformed or inconsistent temporary stream %#', ({ events }) => {
  const protocol = new TemporaryStreamProtocol(request);
  expect(() => {
    for (const event of events) protocol.accept(event);
    protocol.finish();
  }).toThrow();
  expect(() => protocol.accept(completed)).toThrow();
});

it('rejects missing terminal and accepts terminal-only generation', () => {
  const incomplete = new TemporaryStreamProtocol(request);
  incomplete.accept(opened);
  expect(() => incomplete.finish()).toThrow();
  const complete = new TemporaryStreamProtocol(request);
  complete.accept(opened);
  complete.accept(completed);
  complete.finish();
});

it.each(['trailing-frame', 'partial-line', 'stream-error'] as const)(
  'does not deliver completed before clean EOF: %s',
  async (suffix) => {
    const encoder = new TextEncoder();
    const release = Promise.withResolvers<void>();
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    const received: TemporaryConversationEvent[] = [];
    const port = createHttpTemporaryConversationPort({
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                source = controller;
                controller.enqueue(
                  encoder.encode(`${JSON.stringify(opened)}\n${JSON.stringify(completed)}\n`)
                );
              },
            }),
            { headers: { 'Content-Type': 'application/x-ndjson' } }
          )
        ),
    });
    const pending = port.streamTemporaryConversation(request, (event) => {
      received.push(event);
      release.resolve();
      return Promise.resolve();
    });
    const checked = expect(pending).rejects.toBeDefined();
    await release.promise;
    expect(received.map((event) => event.type)).toEqual(['opened']);
    if (source === undefined) throw new Error('Expected stream source.');
    if (suffix === 'stream-error') source.error(new Error('transport failed'));
    else {
      source.enqueue(
        encoder.encode(suffix === 'partial-line' ? 'trailing' : JSON.stringify(completed) + '\n')
      );
      source.close();
    }
    await checked;
    expect(received.map((event) => event.type)).toEqual(['opened']);
  }
);
