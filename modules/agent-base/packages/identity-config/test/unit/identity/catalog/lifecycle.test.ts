import { describe, expect, it } from 'vitest';
import {
  createAgentIdentity,
  defineAgentIdentity,
  disableAgentIdentity,
  reactivateAgentIdentity,
} from '@print-an-agent/base-identity-config/identity';
import { createCatalogStub, snapshot } from '../../../fixtures/identity-catalog.js';

const identity = defineAgentIdentity({ id: 'bro' });

describe('Identity catalog lifecycle', () => {
  it('passes creation authority to the catalog and validates its result', async () => {
    const requests: unknown[] = [];
    const catalog = createCatalogStub({
      create: (request) => {
        requests.push(request);
        return Promise.resolve(snapshot('bro'));
      },
    });
    await expect(createAgentIdentity({ identity, catalog })).resolves.toEqual(snapshot('bro'));
    expect(requests).toEqual([{ identity }]);
  });

  it.each([
    snapshot('mochi'),
    snapshot('bro', 1, 'disabled'),
    snapshot('bro', 2),
    { ...snapshot('bro'), updatedAt: 0 },
  ])('rejects an untruthful creation result: %j', async (result) => {
    await expect(
      createAgentIdentity({
        identity,
        catalog: createCatalogStub({ create: () => Promise.resolve(result) }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
  });

  it.each([
    { operation: disableAgentIdentity, status: 'disabled' as const },
    { operation: reactivateAgentIdentity, status: 'active' as const },
  ])('passes CAS authority and target $status to the catalog', async ({ operation, status }) => {
    const requests: unknown[] = [];
    const result = snapshot('bro', 2, status);
    const catalog = createCatalogStub({
      transition: (request) => {
        requests.push(request);
        return Promise.resolve(result);
      },
    });
    await expect(
      operation({ agentId: identity.id, catalog, expectedRevision: 1 })
    ).resolves.toEqual(result);
    expect(requests).toEqual([{ agentId: identity.id, status, expectedRevision: 1 }]);
  });

  it.each([snapshot('bro', 2), snapshot('bro', 3, 'disabled')])(
    'rejects a transition with the wrong state or revision: %j',
    async (result) => {
      await expect(
        disableAgentIdentity({
          agentId: identity.id,
          expectedRevision: 1,
          catalog: createCatalogStub({ transition: () => Promise.resolve(result) }),
        })
      ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
    }
  );
});
