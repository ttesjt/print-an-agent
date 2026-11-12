import {
  createAgentIdentity,
  defineAgentIdentity,
  disableAgentIdentity,
  listAgentIdentities,
  reactivateAgentIdentity,
  readAgentIdentity,
  renameAgentIdentity,
  type AgentIdentityCatalogPort,
  type AgentIdentityError,
} from '@print-an-agent/base-identity';
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
    it('renames with CAS without changing identity, lifecycle, or creation time', async () => {
      const fixture = createFixture();
      try {
        const identity = defineAgentIdentity({ id: 'named', displayName: 'Original' });
        const created = await createAgentIdentity({ identity, catalog: fixture.catalog });
        await disableAgentIdentity({
          agentId: identity.id,
          catalog: fixture.catalog,
          expectedRevision: 1,
        });
        const request = { agentId: identity.id, catalog: fixture.catalog, expectedRevision: 2 };
        const outcomes = await Promise.allSettled([
          renameAgentIdentity({ ...request, displayName: 'New name' }),
          renameAgentIdentity({ ...request, displayName: 'Racing name' }),
        ]);
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
        const current = await readAgentIdentity({ agentId: identity.id, catalog: fixture.catalog });
        expect(current).toMatchObject({
          identity: { id: identity.id },
          status: 'disabled',
          revision: 3,
          createdAt: created.createdAt,
        });
        expect(['New name', 'Racing name']).toContain(current.identity.displayName);
        await expect(
          renameAgentIdentity({ ...request, expectedRevision: 3, displayName: '   ' })
        ).rejects.toMatchObject({ code: 'AGENT_DISPLAY_NAME_INVALID' });
        expect(
          (await readAgentIdentity({ agentId: identity.id, catalog: fixture.catalog })).revision
        ).toBe(3);
      } finally {
        fixture.dispose?.();
      }
    });
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
