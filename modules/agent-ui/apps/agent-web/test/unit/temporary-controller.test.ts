import { expect, it } from 'vitest';
import { TemporaryConversationController } from '../../src/temporary-conversation/controller.js';
import type {
  TemporaryConversationPort,
  TemporaryConversationRequest,
  TemporaryEventConsumer,
} from '../../src/temporary-conversation/contracts.js';

const target = { agentId: 'demo', displayName: 'Demo', configRevision: '1' };
async function respond(input: TemporaryConversationRequest, consume: TemporaryEventConsumer) {
  await consume({ type: 'opened', interactionId: input.interactionId });
  await consume({ type: 'reasoning-delta', interactionId: input.interactionId, delta: 'thinking' });
  await consume({ type: 'text-delta', interactionId: input.interactionId, delta: 'answer' });
  await consume({
    type: 'completed',
    interactionId: input.interactionId,
    configRevision: input.expectedConfigRevision,
    assistant: {
      text: 'answer',
      timestamp: new Date(1).toISOString(),
      stopReason: 'stop',
      reasoningBlocks: [{ modelTurnIndex: 1, text: 'thinking' }],
    },
  });
}
function fixture(port?: TemporaryConversationPort, limit = 64) {
  const requests: TemporaryConversationRequest[] = [];
  let id = 0;
  const controller = new TemporaryConversationController(
    port ?? {
      streamTemporaryConversation: (input, consume) => {
        requests.push(input);
        return respond(input, consume);
      },
    },
    { createId: () => `send-${id++}`, maxHistoryTurns: limit }
  );
  controller.open(target);
  controller.setDraft('hello');
  return { controller, requests };
}

it('keeps successful text history only and preserves it across close/reopen', async () => {
  const { controller, requests } = fixture();
  await controller.send();
  controller.close();
  controller.open(target);
  controller.setDraft('follow up');
  await controller.send();
  expect(requests[1]?.history).toEqual([{ user: 'hello', assistant: 'answer' }]);
  expect(JSON.stringify(requests[1])).not.toContain('thinking');
  expect(controller.getSnapshot().turns.map((turn) => turn.status)).toEqual([
    'completed',
    'completed',
  ]);
  expect(
    new TemporaryConversationController({
      streamTemporaryConversation: () => Promise.resolve(),
    }).getSnapshot().turns
  ).toEqual([]);
});

it('does not promote completed when the port subsequently rejects', async () => {
  const { controller } = fixture({
    streamTemporaryConversation: async (input, consume) => {
      await respond(input, consume);
      throw new Error('late failure');
    },
  });
  await controller.send();
  expect(controller.getSnapshot().turns[0]?.status).toBe('failed');
});

it('keeps a completed frame provisional until actual port settlement', async () => {
  const delivered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { controller } = fixture({
    streamTemporaryConversation: async (input, consume) => {
      await respond(input, consume);
      delivered.resolve();
      await release.promise;
    },
  });
  const pending = controller.send();
  await delivered.promise;
  expect(controller.getSnapshot()).toMatchObject({ busy: true, turns: [{ status: 'streaming' }] });
  release.resolve();
  await pending;
  expect(controller.getSnapshot()).toMatchObject({ busy: false, turns: [{ status: 'completed' }] });
});

it('reserves send synchronously and preserves explicit cancellation while hidden', async () => {
  const release = Promise.withResolvers<void>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const { controller } = fixture({
    streamTemporaryConversation: async (input, consume) => {
      calls++;
      signal = input.signal;
      await release.promise;
      await respond(input, consume);
    },
  });
  const pending = controller.send();
  await controller.send();
  expect(calls).toBe(1);
  controller.close();
  controller.cancel();
  expect(signal?.aborted).toBe(true);
  release.resolve();
  await pending;
  expect(controller.getSnapshot().turns[0]?.status).toBe('cancelled');
  expect(controller.getSnapshot().open).toBe(false);
});

it.each(['completed', 'failed'] as const)(
  'keeps a hidden response owned until %s and restores it on reopen',
  async (outcome) => {
    const entered = Promise.withResolvers<AbortSignal | undefined>();
    const release = Promise.withResolvers<void>();
    const inputs: TemporaryConversationRequest[] = [];
    const { controller } = fixture({
      streamTemporaryConversation: async (input, consume) => {
        inputs.push(input);
        if (inputs.length === 1) {
          entered.resolve(input.signal);
          await release.promise;
        }
        await respond(input, consume);
        if (inputs.length === 1 && outcome === 'failed') throw new Error('Late port failure');
      },
    });
    const pending = controller.send();
    const signal = await entered.promise;
    controller.close();
    expect(signal?.aborted).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ open: false, busy: true });
    await controller.send();
    expect(inputs).toHaveLength(1);
    release.resolve();
    await pending;
    expect(controller.getSnapshot()).toMatchObject({
      open: false,
      busy: false,
      turns: [{ status: outcome, text: 'answer', reasoning: [{ text: 'thinking' }] }],
    });
    controller.open(target);
    expect(controller.getSnapshot().turns[0]?.status).toBe(outcome);
    controller.setDraft('follow up');
    await controller.send();
    expect(inputs[1]?.history).toEqual(
      outcome === 'completed' ? [{ user: 'hello', assistant: 'answer' }] : []
    );
  }
);

it.each(['failed', 'cancelled'] as const)(
  'retains earlier success but excludes %s partial content from the next request',
  async (outcome) => {
    const inputs: TemporaryConversationRequest[] = [];
    const { controller } = fixture({
      streamTemporaryConversation: async (input, consume) => {
        inputs.push(input);
        if (inputs.length !== 2) return respond(input, consume);
        await consume({ type: 'opened', interactionId: input.interactionId });
        await consume({ type: 'text-delta', interactionId: input.interactionId, delta: 'partial' });
        await consume(
          outcome === 'cancelled'
            ? { type: 'cancelled', interactionId: input.interactionId }
            : {
                type: 'failed',
                interactionId: input.interactionId,
                failure: { code: 'TEMPORARY_REQUEST_FAILED', message: 'Failed' },
              }
        );
      },
    });
    await controller.send();
    controller.setDraft('unsuccessful question');
    await controller.send();
    expect(controller.getSnapshot().turns[1]).toMatchObject({ status: outcome, text: 'partial' });
    controller.setDraft('next question');
    await controller.send();
    expect(inputs[2]?.history).toEqual([{ user: 'hello', assistant: 'answer' }]);
  }
);

it('blocks a changed config until explicit reset and waits for owned disposal drainage', async () => {
  const entered = Promise.withResolvers<AbortSignal | undefined>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const { controller } = fixture({
    streamTemporaryConversation: async (input, consume) => {
      await consume({ type: 'opened', interactionId: input.interactionId });
      if (calls++ === 0) {
        await consume({
          type: 'failed',
          interactionId: input.interactionId,
          failure: { code: 'TEMPORARY_CONFIG_CONFLICT', message: 'Changed config' },
        });
      } else {
        entered.resolve(input.signal);
        await release.promise;
        input.signal?.throwIfAborted();
      }
    },
  });
  await controller.send();
  controller.setDraft('blocked');
  await controller.send();
  expect(calls).toBe(1);
  expect(controller.getSnapshot().blocked).toBe(true);
  controller.clear();
  controller.open({ ...target, configRevision: '2' });
  controller.setDraft('new config');
  const pending = controller.send();
  const signal = await entered.promise;
  let drained = false;
  const disposing = controller.dispose().then(() => {
    drained = true;
  });
  expect(signal?.aborted).toBe(true);
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(controller.getSnapshot().turns).toEqual([]);
  release.resolve();
  await Promise.all([pending, disposing]);
  expect(drained).toBe(true);
  expect(controller.getSnapshot().turns).toEqual([]);
});

it('clear invalidates old callbacks without corrupting a new conversation', async () => {
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const { controller } = fixture({
    streamTemporaryConversation: async (input, consume) => {
      const index = calls++;
      if (index === 0) await release.promise;
      await respond(input, consume);
    },
  });
  const old = controller.send();
  controller.clear();
  controller.setDraft('new question');
  await controller.send();
  release.resolve();
  await old;
  expect(controller.getSnapshot().turns).toHaveLength(1);
  expect(controller.getSnapshot().turns[0]).toMatchObject({
    status: 'completed',
    user: { text: 'new question' },
  });
});

it('requires confirmation before replacing an Agent or config-bound transcript', async () => {
  const { controller } = fixture();
  await controller.send();
  controller.close();
  controller.open({ ...target, configRevision: '2' });
  expect(controller.getSnapshot().pendingTarget?.configRevision).toBe('2');
  expect(controller.getSnapshot().turns).toHaveLength(1);
  controller.dismissReset();
  expect(controller.getSnapshot().target?.configRevision).toBe('1');
  controller.open({ ...target, agentId: 'other' });
  controller.confirmReset();
  expect(controller.getSnapshot()).toMatchObject({
    open: true,
    target: { agentId: 'other' },
    turns: [],
  });
});

it('requires explicit clear at the history limit, without silently evicting or compacting', async () => {
  const { controller, requests } = fixture(undefined, 1);
  await controller.send();
  controller.setDraft('next');
  await controller.send();
  expect(requests).toHaveLength(1);
  expect(controller.getSnapshot().blocked).toBe(true);
  expect(controller.getSnapshot().turns).toHaveLength(1);
  controller.clear();
  expect(controller.getSnapshot().blocked).toBe(false);
});

it('rejects a swallowed protocol error and supports StrictMode-style disposal replay', async () => {
  const { controller } = fixture({
    streamTemporaryConversation: async (input, consume) => {
      try {
        await consume({
          type: 'text-delta',
          interactionId: input.interactionId,
          delta: 'before open',
        });
      } catch {
        /* A faulty port cannot heal its protocol. */
      }
      await respond(input, consume);
    },
  });
  await controller.send();
  expect(controller.getSnapshot().turns[0]?.status).toBe('failed');
  await controller.dispose();
  controller.open(target);
  expect(controller.getSnapshot().turns).toEqual([]);
});
