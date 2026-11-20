import { describe, expect, it } from 'vitest';
import {
  defineAgentIdentity,
  listAgentIdentities,
  readAgentIdentity,
} from '@print-an-agent/base-identity-config/identity';
import { createCatalogStub, snapshot } from '../../../fixtures/identity-catalog.js';

const agentId = defineAgentIdentity({ id: 'bro' }).id;

describe('Identity catalog queries', () => {
  it('rejects missing and cross-Agent catalog results', async () => {
    await expect(
      readAgentIdentity({
        agentId,
        catalog: createCatalogStub({ read: () => Promise.resolve(undefined) }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_NOT_FOUND' });
    await expect(
      readAgentIdentity({
        agentId,
        catalog: createCatalogStub({ read: () => Promise.resolve(snapshot('mochi')) }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
  });

  it('normalizes and freezes adapter snapshots without mutating them', async () => {
    const stored = { ...snapshot('bro'), identity: { id: agentId, displayName: ' Brother ' } };
    const found = await readAgentIdentity({
      agentId,
      catalog: createCatalogStub({ read: () => Promise.resolve(stored) }),
    });
    expect(found.identity.displayName).toBe('Brother');
    expect(found).not.toBe(stored);
    expect(Object.isFrozen(found)).toBe(true);
    expect(Object.isFrozen(found.identity)).toBe(true);
    expect(stored.identity.displayName).toBe(' Brother ');
  });

  it.each([
    { snapshots: [snapshot('zeta'), snapshot('alpha')] },
    { snapshots: [snapshot('alpha'), snapshot('alpha')] },
  ])('requires unique list results ordered by Agent ID: %j', async ({ snapshots }) => {
    await expect(
      listAgentIdentities(createCatalogStub({ list: () => Promise.resolve(snapshots) }))
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
  });

  it.each([{ snapshots: [] }, { snapshots: [snapshot('alpha'), snapshot('zeta')] }])(
    'returns an immutable ordered list: %j',
    async ({ snapshots }) => {
      const result = await listAgentIdentities(
        createCatalogStub({ list: () => Promise.resolve(snapshots) })
      );
      expect(result).toEqual(snapshots);
      expect(Object.isFrozen(result)).toBe(true);
      for (const entry of result) expect(Object.isFrozen(entry)).toBe(true);
    }
  );

  it('validates each listed snapshot and preserves catalog failures', async () => {
    await expect(
      listAgentIdentities(
        createCatalogStub({ list: () => Promise.resolve([{ ...snapshot('bro'), revision: 0 }]) })
      )
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
    const failure = new Error('catalog unavailable');
    await expect(
      readAgentIdentity({
        agentId,
        catalog: createCatalogStub({ read: () => Promise.reject(failure) }),
      })
    ).rejects.toBe(failure);
  });
});
