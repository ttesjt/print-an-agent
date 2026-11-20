import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { expect, it } from 'vitest';
import { MemoryJournal } from '../../../../src/management/session-context-memory/journal.js';
import { storedRuntimeMemoryFixture as fixture } from '../../../support/management/session-context-memory-storage.js';
for (const storage of ['memory', 'sqlite'] as const) {
  it(`${storage}: stale or absent journal versions cannot update another intent`, async () => {
    const f = await fixture(storage);
    const ref = await f.session.resolve({ agentId: parseAgentId('journal-cas') });
    const journal = new MemoryJournal(f.session, ref);
    const original = await journal.put('mutation', 'cas', { input: 'original' }, false);
    const updated = await journal.put('mutation', 'cas', { input: 'updated' }, false, original);
    await expect(
      journal.put('mutation', 'cas', { input: 'overwrite' }, false)
    ).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CONFLICT',
    });
    await expect(
      journal.put('mutation', 'cas', { input: 'overwrite' }, false, original)
    ).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CONFLICT',
    });
    expect(await journal.read('mutation', 'cas')).toEqual(updated);
    expect(await journal.put('mutation', 'cas', { input: 'updated' }, false, original)).toEqual(
      updated
    );
  });
}
