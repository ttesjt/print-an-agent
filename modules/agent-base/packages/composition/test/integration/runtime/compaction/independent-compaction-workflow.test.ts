import {
  BUILT_IN_RESPONSIBILITIES,
  createAgentActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  MAIN_ACTOR_ID,
} from '@print-an-agent/agent-actor';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { MemorySessionAdapter } from '@print-an-agent/base-local-adapters';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  createShouldCompactSessionCondition,
  DEFAULT_SESSION_COMPACTION_POLICY,
  type CreateSessionCompactionWorkflowOptions,
  type SessionCompactionWorkflowInput,
} from '@print-an-agent/base-session';
import type { ActorDirectHandler } from '@print-an-agent/model-invocation-core';
import { expect, it, vi } from 'vitest';
import {
  compactionMessage,
  seedCompactionSession,
} from '../../../support/runtime/compaction-fixture.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

async function independentCompaction(
  complete: ActorDirectHandler,
  executeStep?: CreateSessionCompactionWorkflowOptions['executeStep']
) {
  const identity = defineAgentIdentity({ id: 'independent-compaction' });
  const session = new MemorySessionAdapter();
  const reference = await seedCompactionSession(session, identity);
  const workflow = createSessionCompactionWorkflow({
    resources: {
      session,
      responsibilities: createResponsibilityRouter({
        actorCatalog: createAgentActorCatalog({
          actors: [{ id: MAIN_ACTOR_ID, engineId: 'independent' }],
          engines: [
            {
              id: 'independent',
              capabilities: {
                invocationModes: ['direct'],
                inputMediaTypes: ['text'],
                toolCalling: false,
                structuredOutput: false,
                cancellation: true,
              },
              complete,
            },
          ],
        }),
        responsibilityCatalog: createResponsibilityCatalog({
          responsibilities: BUILT_IN_RESPONSIBILITIES,
        }),
      }),
      tokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      instructions: 'Compact the supplied conversation.',
      policy: {
        ...DEFAULT_SESSION_COMPACTION_POLICY,
        maxContextTokens: 10,
        target: { maxTokens: 10 },
      },
      clock: () => 1,
    },
    condition: createShouldCompactSessionCondition(),
    stepOverrides: createDefaultSessionCompactionStepOverrides(),
    ...(executeStep === undefined ? {} : { executeStep }),
  });
  const input: SessionCompactionWorkflowInput = {
    agentId: identity.id,
    compactionInput: { sessionId: reference.sessionId },
  };
  return { workflow, session, reference, input };
}

it('rewrites an oversized draft, commits once and condition-skips a later call without an Agent', async () => {
  const outputs = ['x'.repeat(20), 'short'];
  const complete = vi.fn<ActorDirectHandler>((request) => {
    if (outputs.length === 1) {
      expect(request.messages.at(-1)?.text).toContain('20 measured tokens');
      expect(request.messages.some((message) => message.text === 'original-fact-1')).toBe(true);
    }
    return Promise.resolve({ message: compactionMessage(outputs.shift() ?? 'unexpected') });
  });
  const fixture = await independentCompaction(complete);
  const commit = vi.spyOn(fixture.session, 'commitCompaction');
  const release = vi.spyOn(fixture.session, 'releaseSessionExecution');
  await expect(fixture.workflow.run({ input: fixture.input })).resolves.toMatchObject({
    status: 'compacted',
    compactedTurnCount: 2,
  });
  expect(complete).toHaveBeenCalledTimes(2);
  expect(commit).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  expect(await fixture.session.readCompaction(fixture.reference)).toMatchObject({
    revision: 1,
    context: { text: 'short' },
  });
  await expect(fixture.workflow.run({ input: fixture.input })).resolves.toBeUndefined();
  expect(commit).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledOnce();
});

it('exhausts candidates without committing and releases the execution lease', async () => {
  const complete = vi.fn<ActorDirectHandler>(() =>
    Promise.resolve({ message: compactionMessage('x'.repeat(20)) })
  );
  const fixture = await independentCompaction(complete);
  const commit = vi.spyOn(fixture.session, 'commitCompaction');
  const release = vi.spyOn(fixture.session, 'releaseSessionExecution');
  await expect(fixture.workflow.run({ input: fixture.input })).rejects.toMatchObject({
    code: 'SESSION_COMPACTION_ATTEMPTS_EXHAUSTED',
    generationAttempts: 3,
    targetTokens: 10,
  });
  expect(complete).toHaveBeenCalledTimes(3);
  expect(commit).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(await fixture.session.readCompaction(fixture.reference)).toBeUndefined();
});

it('propagates a Step executor cancellation into the active Actor and drains before lease release', async () => {
  const parent = new AbortController();
  const entered = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<AbortSignal>();
  const drain = Promise.withResolvers<void>();
  const failure = new Error('compaction Step executor failed');
  const fixture = await independentCompaction(
    async (request) => {
      request.signal.addEventListener('abort', () => cancelled.resolve(request.signal), {
        once: true,
      });
      entered.resolve();
      await cancelled.promise;
      await drain.promise;
      throw request.signal.reason;
    },
    async ({ stepName, step, context }) => {
      if (stepName === 'generateCompactionCandidate') {
        void step(context).catch(() => undefined);
        await entered.promise;
        throw failure;
      }
      await step(context);
    }
  );
  const commit = vi.spyOn(fixture.session, 'commitCompaction');
  const release = vi.spyOn(fixture.session, 'releaseSessionExecution');
  const run = fixture.workflow.run({ input: fixture.input, signal: parent.signal });
  const observed = run.catch(() => undefined);
  try {
    const effective = await cancelled.promise;
    expect(effective.aborted).toBe(true);
    expect(effective.reason).toBe(failure);
    expect(parent.signal.aborted).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    drain.resolve();
    await expect(run).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  } finally {
    parent.abort();
    drain.resolve();
    await observed;
  }
});
