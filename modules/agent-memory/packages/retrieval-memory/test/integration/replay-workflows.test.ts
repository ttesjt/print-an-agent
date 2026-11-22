import { expect, it } from 'vitest';
import {
  createRetrievalCreateDefinition,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  findRetrievalCommit,
} from '@print-an-agent/retrieval-memory';
import { fixture } from '../support/fixture.js';

it.each(['cancellation', 'executor'] as const)(
  'preserves a replayed receipt when preparation is followed by %s',
  async (mode) => {
    const f = fixture();
    const committed = await f.create();
    const index = f.spaces.get('space')!.index;
    const controller = new AbortController();
    const getReceipt = f.backend.getReceipt.bind(f.backend);
    f.backend.getReceipt = async (...args) => {
      const receipt = await getReceipt(...args);
      if (mode === 'cancellation') controller.abort();
      return receipt;
    };
    const bundle = createRetrievalMemoryBundle({
      resources: createRetrievalWorkflowResources(f.resources),
      workflows: {
        create: createRetrievalCreateDefinition({
          executeStep: async (execution) => {
            await execution.step(execution.context);
            if (mode === 'executor' && execution.stepName === 'prepareCandidate')
              throw new Error('preparation executor cleanup failed');
          },
        }),
      },
    });
    const error: unknown = await bundle.workflows.create
      .run({
        input: {
          memoryId: 'space',
          requestId: 'create',
          index: {
            embeddingRef: index.embeddingRef,
            chunkerRef: index.chunkerRef,
            metricRef: index.metricRef,
          },
        },
        signal: controller.signal,
      })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(findRetrievalCommit(error)).toEqual({ status: 'committed', receipt: committed.receipt });
    expect(f.calls).toEqual({ embeddings: 0, publication: 1 });
    expect(f.receipts.size).toBe(1);
    expect(controller.signal.aborted).toBe(mode === 'cancellation');
  }
);
