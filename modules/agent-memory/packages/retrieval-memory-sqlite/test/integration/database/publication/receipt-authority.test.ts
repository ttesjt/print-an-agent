import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { fixture } from '../../../support/fixture.js';
it('restores an original receipt before attempting unrelated current-state reads', async () => {
  const f = await fixture();
  await f.create();
  const signal = new AbortController().signal;
  const prepared = await f.mutations.prepare(
    'ingest',
    { memoryId: 'space', requestId: 'a', content: 'aligned' },
    signal
  );
  if (!('publication' in prepared)) throw new Error('Expected candidate');
  const original = await f.backend.publish(prepared.publication, signal);
  const db = new DatabaseSync(f.path);
  try {
    db.exec("UPDATE rm_entries SET representation_json='not valid JSON'");
    expect(await f.backend.publish(prepared.publication, signal)).toEqual(original);
    expect(await f.backend.getReceipt('space', 'a', signal)).toEqual(original);
  } finally {
    db.close();
  }
});
