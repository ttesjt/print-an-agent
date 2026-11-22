import type { RetrievalReceipt, RetrievalSpace } from '@print-an-agent/retrieval-memory';
import type { WorkerClient } from '../../src/worker/index.js';

export async function checkWorkerCalls(client: WorkerClient): Promise<void> {
  const space: RetrievalSpace | undefined = await client.call('inspect', ['memory']);
  const receipt: RetrievalReceipt | undefined = await client.call('getReceipt', [
    'memory',
    'request',
  ]);
  const closed: void = await client.call('close', []);
  void [space, receipt, closed];
  // @ts-expect-error Entry reads require both identities.
  await client.call('get', ['memory']);
  // @ts-expect-error Publish accepts a publication, not a string identity.
  await client.call('publish', ['memory']);
  // @ts-expect-error Cancellation travels separately from the operation arguments.
  await client.call('inspect', ['memory', new AbortController().signal]);
  // @ts-expect-error Space snapshots cannot be mistaken for receipts.
  const wrong: RetrievalReceipt | undefined = await client.call('inspect', ['memory']);
  void wrong;
}
