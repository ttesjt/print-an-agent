import { describe, expect, it } from 'vitest';
import {
  defineAgentIdentity,
  renameAgentIdentity,
} from '@print-an-agent/base-identity-config/identity';
import { createCatalogStub, snapshot } from '../../../fixtures/identity-catalog.js';

const options = {
  agentId: defineAgentIdentity({ id: 'bro' }).id,
  expectedRevision: 1,
  displayName: ' Brother ',
};
const renamed = {
  ...snapshot('bro', 2),
  identity: defineAgentIdentity({ id: 'bro', displayName: 'Brother' }),
};

describe('Identity catalog metadata', () => {
  it('rejects unsupported metadata capability before reading the catalog', async () => {
    await expect(
      renameAgentIdentity({ ...options, catalog: createCatalogStub({}) })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_METADATA_UNSUPPORTED' });
  });

  it('checks the current revision before calling rename', async () => {
    let writes = 0;
    await expect(
      renameAgentIdentity({
        ...options,
        catalog: createCatalogStub({
          read: () => Promise.resolve(snapshot('bro', 2)),
          rename: () => {
            writes += 1;
            return Promise.resolve(renamed);
          },
        }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_REVISION_CONFLICT' });
    expect(writes).toBe(0);
  });

  it('normalizes the display name and preserves other Identity authority', async () => {
    const requests: unknown[] = [];
    const result = await renameAgentIdentity({
      ...options,
      catalog: createCatalogStub({
        read: () => Promise.resolve(snapshot('bro')),
        rename: (request) => {
          requests.push(request);
          return Promise.resolve(renamed);
        },
      }),
    });
    expect(result).toEqual(renamed);
    expect(Object.isFrozen(result)).toBe(true);
    expect(requests).toEqual([
      { agentId: options.agentId, displayName: 'Brother', expectedRevision: 1 },
    ]);
  });

  it.each([
    { ...renamed, identity: defineAgentIdentity({ id: 'mochi', displayName: 'Brother' }) },
    { ...renamed, identity: defineAgentIdentity({ id: 'bro', displayName: 'Unexpected' }) },
    { ...renamed, revision: 3 },
    { ...renamed, status: 'disabled' as const },
    { ...renamed, createdAt: 2 },
  ])('rejects a rename result that changed unrelated authority: %j', async (result) => {
    await expect(
      renameAgentIdentity({
        ...options,
        catalog: createCatalogStub({
          read: () => Promise.resolve(snapshot('bro')),
          rename: () => Promise.resolve(result),
        }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
  });
});
