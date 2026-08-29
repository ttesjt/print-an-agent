import { describe, expect, it } from 'vitest';

import { listMatchingRecords } from '../../src/queries/list-records.js';

describe('listMatchingRecords', () => {
  it('rejects an empty persistence page that claims more records exist', async () => {
    await expect(
      listMatchingRecords({
        load: () => Promise.resolve({ records: [], hasMore: true }),
        identity: (record: Readonly<{ id: string }>) => record.id,
      })
    ).rejects.toMatchObject({ code: 'DISCOVERY_PERSISTENCE_INVALID' });
  });
});
