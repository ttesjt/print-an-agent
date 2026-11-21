import {
  createAgentManagementService,
  createContextMemoryManagementService,
  MemoryManagementError,
} from '@print-an-agent/base-composition';
import {
  assertMemoryNotAborted,
  ContextMemoryError,
  createMemoryApplyDefinition,
  parseDeterministicMemoryRequest,
  requestDigest,
  type MemoryWorkflowDefinitions,
} from '@print-an-agent/context-memory';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import { expect, it, onTestFinished } from 'vitest';
import { createStandaloneMemorySetup } from '../../../src/index.js';
import { resourceProfileConfig } from '../../support/resource-profile.js';

const target = { agentId: 'a', memoryId: 'notes' };

const input = {
  ...target,
  requestId: 'apply',
  expectedRevision: 1,
  commands: [{ op: 'add' as const, content: 'exactly once' }],
};

async function fixture(workflows?: Partial<MemoryWorkflowDefinitions>) {
  const setup = createStandaloneMemorySetup(
    {
      readEnvironmentVariable: () => {
        throw new Error('Memory management must not acquire credentials');
      },
    },
    {
      storageNamespaceId: 'failures',
      context: {
        defaults: { measurementRef: 'chars' },
        acquireCounter: () => ({
          value: createTokenCounter({
            measurementRef: 'chars',
            inputContract: TEXT_TOKEN_INPUT_CONTRACT,
            measure: (value) => Promise.resolve({ tokens: value.text.length, accuracy: 'exact' }),
          }),
        }),
        ...(workflows === undefined ? {} : { workflows }),
      },
    }
  );
  onTestFinished(() => setup.close({ mode: 'abort' }));
  await createAgentManagementService(setup.definition).create({
    identity: { id: target.agentId },
    config: resourceProfileConfig(),
  });
  const service = createContextMemoryManagementService(setup.definition);
  await service.create({ ...target, requestId: 'create' });
  return { definition: setup.definition, service };
}

it.each(['before', 'after'] as const)(
  'does not classify cancellation plus cleanup failure as ordinary cancellation (%s commit)',
  async (when) => {
    const abort = new AbortController();
    const cleanup = new ContextMemoryError('CLEANUP_FAILED', 'private /secret.db key=hidden');
    const { service } = await fixture({
      apply: createMemoryApplyDefinition({
        executeStep: async (execution) => {
          if (when === 'before' && execution.stepName === 'executeOperation') {
            abort.abort();
            assertMemoryNotAborted(execution.context.signal);
          }
          await execution.step(execution.context);
          if (when === 'after' && execution.stepName === 'executeOperation') {
            abort.abort();
            assertMemoryNotAborted(execution.context.signal);
          }
        },
        lifecycle: {
          onFinally: () => {
            throw cleanup;
          },
        },
      }),
    });
    const error: unknown = await service
      .apply(input, { signal: abort.signal })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: 'MEMORY_OPERATION_FAILED',
      failure: {
        code: 'CLEANUP_FAILED',
        commit:
          when === 'after'
            ? { status: 'committed', receipt: { requestId: 'apply', revision: 2 } }
            : { status: 'not-committed' },
      },
    });
    if (!(error instanceof MemoryManagementError)) throw new Error('Expected management error');
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect(JSON.stringify(error)).not.toMatch(/secret.db|hidden/);
    expect((await service.inspect(target)).value?.revision).toBe(when === 'after' ? 2 : 1);
    expect((await service.getReceipt({ ...target, requestId: 'apply' })).value?.revision).toBe(
      when === 'after' ? 2 : undefined
    );
  }
);

it('also detects cleanup failure nested below a cancellation error, without an AggregateError', async () => {
  const { service, definition } = await fixture();
  const cleanup = new ContextMemoryError('CLEANUP_FAILED', 'private cleanup');
  const cancelled = new ContextMemoryError('OPERATION_ABORTED', 'cancelled', {
    cause: new Error('wrapper', { cause: cleanup }),
    commit: { status: 'not-committed' },
  });
  const factories = definition.contextMemoryManagement!.resolve;
  const wrapped = createContextMemoryManagementService({
    ...definition,
    contextMemoryManagement: {
      resolve: {
        ...factories,
        apply: async (request, options) => {
          const invocation = await factories.apply(request, options);
          return { ...invocation, invoke: () => Promise.reject(cancelled) };
        },
      },
    },
  });
  await expect(wrapped.apply(input)).rejects.toMatchObject({
    code: 'MEMORY_OPERATION_FAILED',
    failure: { code: 'CLEANUP_FAILED', commit: { status: 'not-committed' } },
    cause: cancelled,
  });
  expect((await service.inspect(target)).value?.revision).toBe(1);
});

it.each(
  (['memory', 'request', 'digest', 'operation', 'malformed'] as const).flatMap((distractor) =>
    (['first', 'last'] as const).map((order) => ({ distractor, order }))
  )
)(
  'recovers this request from all evidence ($distractor distractor $order)',
  async ({ distractor, order }) => {
    const { service, definition } = await fixture();
    const factories = definition.contextMemoryManagement!.resolve;
    const wrapped = createContextMemoryManagementService({
      ...definition,
      contextMemoryManagement: {
        resolve: {
          ...factories,
          apply: async (request, options) => {
            const invocation = await factories.apply(request, options);
            return {
              memoryId: invocation.memoryId,
              invoke: async (signal) => {
                const result = await invocation.invoke(signal);
                if (result.status === 'skipped') throw new Error('Unexpected skip');
                const receipt = result.receipt;
                const foreign = {
                  ...receipt,
                  ...(distractor === 'memory' ? { memoryId: 'foreign' } : {}),
                  ...(distractor === 'request' ? { requestId: 'foreign' } : {}),
                  ...(distractor === 'operation' ? { operation: 'configure' as const } : {}),
                  ...(distractor === 'malformed' ? { revision: 0 } : {}),
                  ...(distractor === 'digest'
                    ? {
                        inputDigest: requestDigest(
                          parseDeterministicMemoryRequest('apply', {
                            ...request.input,
                            memoryId: invocation.memoryId,
                            commands: [],
                          }).request
                        ),
                      }
                    : {}),
                };
                const current = new ContextMemoryError('CLEANUP_FAILED', 'current cleanup', {
                  commit: { status: 'committed', receipt },
                });
                const unrelated = new ContextMemoryError('CLEANUP_FAILED', 'foreign cleanup', {
                  commit: { status: 'committed', receipt: foreign },
                });
                // Evidence may be nested under another error's own rejected receipt.
                const nested = new ContextMemoryError('CLEANUP_FAILED', 'nested cleanup', {
                  commit: { status: 'committed', receipt: foreign },
                  cause: current,
                });
                throw new AggregateError(
                  order === 'first' ? [unrelated, nested] : [current, unrelated]
                );
              },
            };
          },
        },
      },
    });
    const error: unknown = await wrapped.apply(input).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: 'MEMORY_OPERATION_FAILED',
      failure: {
        code: 'CLEANUP_FAILED',
        commit: {
          status: 'committed',
          receipt: { requestId: 'apply', revision: 2 },
        },
      },
    });
    if (!(error instanceof MemoryManagementError)) throw new Error('Expected management error');
    expect(error.failure?.commit).toEqual({
      status: 'committed',
      receipt: (await service.getReceipt({ ...target, requestId: 'apply' })).value,
    });
    expect(JSON.stringify(error)).not.toContain('foreign');
    expect((await wrapped.apply(input)).value).toMatchObject({
      status: 'committed',
      receipt: { revision: 2 },
    });
    expect((await service.inspect(target)).value?.items.map((item) => item.content)).toEqual([
      'exactly once',
    ]);
  }
);
