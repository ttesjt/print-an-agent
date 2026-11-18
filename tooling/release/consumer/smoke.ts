import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActor, requireCompletionCapability } from '@print-an-agent/model-invocation-core';
import { createPiFauxRuntime, createPiProviderRuntime } from '@print-an-agent/model-invocation-pi';
import {
  createSessionlessRequestWorkflow,
  type OutputStreamEvent,
  type SessionlessOutputSink,
} from '@print-an-agent/base-request';
import { completionServer } from './completion-server.ts';

function providerActor(baseUrl: string) {
  const provider = createPiProviderRuntime({
    provider: {
      kind: 'openai-compatible',
      reference: { provider: 'fixture', model: 'fixture', baseUrl },
      contextWindowTokens: 4096,
      maxOutputTokens: 256,
      supportsReasoning: true,
      compatibility: { supportsDeveloperRole: false },
    },
  });
  return createActor({ id: 'chat', engine: provider.actorEngine });
}

function channel(onWrite?: SessionlessOutputSink['write']) {
  const events: OutputStreamEvent[] = [];
  const lifecycle: string[] = [];
  const sink: SessionlessOutputSink = {
    async open() {
      lifecycle.push('open');
    },
    async write(event) {
      events.push(event);
      await onWrite?.(event);
    },
    async close() {
      lifecycle.push('close');
    },
    async fail(failure) {
      lifecycle.push(failure.code);
    },
  };
  return { events, lifecycle, sink };
}

test('a plain program completes through the public Actor and Pi APIs', async () => {
  const server = await completionServer();
  try {
    const actor = requireCompletionCapability(providerActor(server.baseUrl));
    const result = await actor.complete({
      instructions: 'Answer briefly.',
      messages: [{ role: 'user', text: 'hello', timestamp: 1 }],
      signal: new AbortController().signal,
      maxOutputCharacters: 1024,
    });
    assert.equal(result.message.text, 'proposed update');
    assert.equal(result.message.provenance.kind, 'provider-model');
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test('history, separate reasoning and text, awaited writes, and concurrent run isolation', async () => {
  const server = await completionServer();
  const held = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const first = channel(async () => {
    entered.resolve();
    await held.promise;
  });
  const second = channel();
  try {
    const workflow = createSessionlessRequestWorkflow({
      mode: 'stream',
      resources: {
        actor: providerActor(server.baseUrl),
        createOutputSink: ({ request }) => (request.message === 'first' ? first.sink : second.sink),
      },
    });
    const pending = workflow.run({
      input: { message: 'first', history: [{ role: 'user', text: 'earlier', timestamp: 1 }] },
    });
    await entered.promise;
    try {
      const result = await workflow.run({ input: { message: 'second' } });
      assert.equal(result?.message.text, 'proposed update');
      assert.deepEqual(second.lifecycle, ['open', 'close']);
      assert.equal(first.events.length, 1);
      assert.deepEqual(first.lifecycle, ['open']);
    } finally {
      held.resolve();
    }
    assert.equal((await pending)?.message.text, 'proposed update');
    assert.deepEqual(first.lifecycle, ['open', 'close']);
    for (const { events } of [first, second]) {
      assert.deepEqual(
        events.map((e) => [e.type, e.delta]),
        [
          ['reasoning-delta', 'consider '],
          ['reasoning-delta', 'the fact'],
          ['text-delta', 'proposed '],
          ['text-delta', 'update'],
        ]
      );
    }
    assert.deepEqual(
      server.requests.map((body) => {
        const { messages } = body as { messages: { role: string; content: unknown }[] };
        return messages.filter((m) => m.role === 'user').map((m) => m.content);
      }),
      [['earlier', 'first'], ['second']]
    );
  } finally {
    held.resolve();
    await server.close();
  }
});

test('cancelling an active run aborts the provider connection and fails its channel', async () => {
  const release = Promise.withResolvers<void>();
  const server = await completionServer({ afterFirstChunk: release.promise });
  const controller = new AbortController();
  const reason = new Error('caller disconnected');
  const output = channel(async () => {
    controller.abort(reason);
  });
  try {
    const workflow = createSessionlessRequestWorkflow({
      mode: 'stream',
      resources: { actor: providerActor(server.baseUrl), createOutputSink: () => output.sink },
    });
    await assert.rejects(
      workflow.run({ input: { message: 'cancel' }, signal: controller.signal }),
      { code: 'MODEL_INVOCATION_CANCELLED' }
    );
    await server.clientClosed;
    assert.equal(output.events.length, 1);
    assert.deepEqual(output.lifecycle, ['open', 'MODEL_INVOCATION_CANCELLED']);
  } finally {
    release.resolve();
    await server.close();
  }
});

test('a failed write rejects the run and reports a single safe output failure', async () => {
  const server = await completionServer();
  const cause = new Error('sink disconnected');
  const output = channel(async () => {
    throw cause;
  });
  try {
    const workflow = createSessionlessRequestWorkflow({
      mode: 'stream',
      resources: { actor: providerActor(server.baseUrl), createOutputSink: () => output.sink },
    });
    await assert.rejects(workflow.run({ input: { message: 'fail' } }), {
      code: 'REQUEST_OUTPUT_FAILED',
      cause,
    });
    assert.deepEqual(output.lifecycle, ['open', 'REQUEST_OUTPUT_FAILED']);
  } finally {
    await server.close();
  }
});

test('provider errors reach the caller and fail the channel', async () => {
  const provider = createPiFauxRuntime({
    responses: [{ status: 'failure', message: 'fixture failure' }],
  });
  const output = channel();
  const workflow = createSessionlessRequestWorkflow({
    mode: 'stream',
    resources: {
      actor: createActor({ id: 'chat', engine: provider.actorEngine }),
      createOutputSink: () => output.sink,
    },
  });
  await assert.rejects(workflow.run({ input: { message: 'fail' } }), {
    code: 'MODEL_PROVIDER_FAILED',
  });
  assert.deepEqual(output.lifecycle, ['open', 'MODEL_PROVIDER_FAILED']);
});
