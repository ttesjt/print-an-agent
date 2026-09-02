import {
  createAgentIdentity,
  defineAgentIdentity,
  disableAgentIdentity,
  listAgentIdentities,
  reactivateAgentIdentity,
  readAgentIdentity,
  type AgentIdentityCatalogPort,
  type AgentIdentityError,
} from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';

export interface IdentityCatalogFixture {
  readonly catalog: AgentIdentityCatalogPort;
  readonly dispose?: () => void;
}

async function expectIdentityError(
  action: () => Promise<unknown>,
  code: AgentIdentityError['code']
): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

export function defineIdentityCatalogContract(
  name: string,
  createFixture: () => IdentityCatalogFixture
): void {
  describe(`${name} Identity Catalog contract`, () => {
    it('creates, reads, and lists isolated identities in stable order', async () => {
      const fixture = createFixture();
      try {
        const mochi = defineAgentIdentity({ id: 'mochi', displayName: 'Mochi' });
        const bro = defineAgentIdentity({ id: 'bro', displayName: 'Bro' });
        await createAgentIdentity({ identity: mochi, catalog: fixture.catalog });
        await createAgentIdentity({ identity: bro, catalog: fixture.catalog });

        await expect(
          readAgentIdentity({ agentId: mochi.id, catalog: fixture.catalog })
        ).resolves.toMatchObject({ identity: mochi, status: 'active', revision: 1 });
        expect(
          (await listAgentIdentities(fixture.catalog)).map((item) => item.identity.id)
        ).toEqual([bro.id, mochi.id]);
      } finally {
        fixture.dispose?.();
      }
    });

    it('disables and reactivates with explicit revisions while retaining identity', async () => {
      const fixture = createFixture();
      try {
        const identity = defineAgentIdentity({ id: 'bro', displayName: 'Bro' });
        const created = await createAgentIdentity({ identity, catalog: fixture.catalog });
        const disabled = await disableAgentIdentity({
          agentId: identity.id,
          catalog: fixture.catalog,
          expectedRevision: created.revision,
        });
        expect(disabled).toMatchObject({ identity, status: 'disabled', revision: 2 });
        expect(disabled.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

        await expect(
          reactivateAgentIdentity({
            agentId: identity.id,
            catalog: fixture.catalog,
            expectedRevision: disabled.revision,
          })
        ).resolves.toMatchObject({ identity, status: 'active', revision: 3 });
      } finally {
        fixture.dispose?.();
      }
    });

    it('rejects duplicates, missing identities, stale writes, and repeated transitions', async () => {
      const fixture = createFixture();
      try {
        const identity = defineAgentIdentity({ id: 'bro' });
        await createAgentIdentity({ identity, catalog: fixture.catalog });
        await expectIdentityError(
          () => createAgentIdentity({ identity, catalog: fixture.catalog }),
          'AGENT_IDENTITY_ALREADY_EXISTS'
        );
        await expectIdentityError(
          () =>
            readAgentIdentity({
              agentId: defineAgentIdentity({ id: 'missing' }).id,
              catalog: fixture.catalog,
            }),
          'AGENT_IDENTITY_NOT_FOUND'
        );
        await disableAgentIdentity({
          agentId: identity.id,
          catalog: fixture.catalog,
          expectedRevision: 1,
        });
        await expectIdentityError(
          () =>
            reactivateAgentIdentity({
              agentId: identity.id,
              catalog: fixture.catalog,
              expectedRevision: 1,
            }),
          'AGENT_IDENTITY_REVISION_CONFLICT'
        );
        await expectIdentityError(
          () =>
            disableAgentIdentity({
              agentId: identity.id,
              catalog: fixture.catalog,
              expectedRevision: 2,
            }),
          'AGENT_IDENTITY_STATUS_TRANSITION_INVALID'
        );
      } finally {
        fixture.dispose?.();
      }
    });
  });
}
