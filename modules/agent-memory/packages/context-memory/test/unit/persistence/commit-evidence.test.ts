import { expect, it } from 'vitest';
import {
  ContextMemoryError,
  findContextMemoryCommit,
  MemoryMeter,
  MemoryMutations,
} from '@print-an-agent/context-memory';
import type { CommitStatus } from '@print-an-agent/context-memory';
import { testCounter } from '../../support/counter.js';
import { TestMemoryStore } from '../../support/store.js';

async function receipt() {
  const result = await new MemoryMutations({
    store: new TestMemoryStore(),
    meter: new MemoryMeter({ counter: testCounter() }),
    defaults: { measurementRef: 'chars' },
  }).create({ memoryId: 'notes', requestId: 'create' });
  if (result.status === 'skipped') throw new Error('Unexpected skip');
  return result.receipt;
}

const failure = (commit: CommitStatus, cause?: unknown) =>
  new ContextMemoryError('CLEANUP_FAILED', 'test cleanup', { commit, cause });

it.each(['first', 'last'] as const)(
  'filters each piece of evidence before selecting a commit (foreign %s)',
  async (order) => {
    const current = await receipt();
    const committed: CommitStatus = { status: 'committed', receipt: current };
    const unrelated = failure({
      status: 'committed',
      receipt: { ...current, requestId: 'other' },
    });
    const errors = [unrelated, failure(committed)];
    if (order === 'last') errors.reverse();
    expect(
      findContextMemoryCommit(
        new AggregateError(errors),
        (commit) => commit.status === 'committed' && commit.receipt.requestId === 'create'
      )
    ).toEqual(committed);
  }
);

it('searches the cause of rejected evidence and safely visits shared or cyclic errors', async () => {
  const current = await receipt();
  const known: CommitStatus = { status: 'committed', receipt: current };
  const nested = failure(
    { status: 'committed', receipt: { ...current, memoryId: 'other' } },
    failure(known)
  );
  const root = new AggregateError([nested, nested]);
  root.errors.unshift(root);
  expect(
    findContextMemoryCommit(
      root,
      (commit) => commit.status === 'committed' && commit.receipt.memoryId === 'notes'
    )
  ).toEqual(known);
  expect(findContextMemoryCommit(root, () => false)).toBeUndefined();
});

it('ranks only accepted evidence: committed, unknown, then not-committed', async () => {
  const known: CommitStatus = { status: 'committed', receipt: await receipt() };
  const unknown: CommitStatus = { status: 'unknown', memoryId: 'notes', requestId: 'create' };
  const none: CommitStatus = { status: 'not-committed' };
  const root = new AggregateError([failure(none), failure(unknown), failure(known)]);
  expect(findContextMemoryCommit(root)).toEqual(known);
  expect(findContextMemoryCommit(root, (commit) => commit.status !== 'committed')).toEqual(unknown);
  expect(findContextMemoryCommit(root, (commit) => commit.status === 'not-committed')).toEqual(
    none
  );
  expect(findContextMemoryCommit(new Error('no evidence'))).toBeUndefined();
});
