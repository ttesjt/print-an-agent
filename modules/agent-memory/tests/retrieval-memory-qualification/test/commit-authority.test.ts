import { Workflow } from '@ta-agent/workflow-core';
import {
  createRetrievalIngestDefinition,
  findRetrievalCommit,
  RetrievalMemoryError,
} from '@ta-agent/retrieval-memory';
import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
it('does not let an executor-supplied unknown status overwrite a known receipt', async () => {
  const f = await fixture();
  await f.create();
  const workflow = new Workflow({
    ...createRetrievalIngestDefinition({
      executeStep: async (execution) => {
        await execution.step(execution.context);
        if (execution.stepName === 'publish')
          throw new RetrievalMemoryError('CLEANUP_FAILED', 'Post-processing failed.', {
            commit: { status: 'unknown', memoryId: 'space', requestId: 'a' },
          });
      },
    }),
    resources: f.resources,
  });
  const error = await workflow
    .run({ input: { memoryId: 'space', requestId: 'a', content: 'match' } })
    .catch((cause: unknown) => cause);
  expect(findRetrievalCommit(error)).toMatchObject({
    status: 'committed',
    receipt: { sequence: 1, requestId: 'a' },
  });
});
it('rejects reused representation identities even when a custom candidate has a new Entry revision', async () => {
  const f = await fixture();
  await f.create();
  const { receipt } = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'match',
  });
  const before = await f.ports.backend.get('space', receipt.entryId!, f.signal);
  const prepared = await f.mutations.prepare(
    'update',
    {
      memoryId: 'space',
      requestId: 'b',
      entryId: receipt.entryId!,
      expectedRevision: 1,
      content: 'second',
    },
    f.signal
  );
  if (
    before === undefined ||
    !('publication' in prepared) ||
    prepared.publication.representation === null
  )
    throw new Error('Expected candidate');
  const publication = prepared.publication;
  const representation = prepared.publication.representation;
  const reused = {
    ...publication,
    representation: {
      ...representation,
      representationId: before.representation.representationId,
      chunks: representation.chunks.map((chunk) => ({
        ...chunk,
        representationId: before.representation.representationId,
      })),
    },
  };
  await expect(f.ports.backend.publish(reused, f.signal)).rejects.toMatchObject({
    code: 'REPRESENTATION_INVALID',
  });
  expect(
    (await f.queries.get({ memoryId: 'space', entryId: receipt.entryId! }, f.signal)).revision
  ).toBe(1);
});
