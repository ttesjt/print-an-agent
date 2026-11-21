import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  defineManagedAgentComposition,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  createRequestFingerprint,
  parseRequestIdempotencyKey,
  type InspectableRequestJournalPort,
  type RequestJournalPort,
} from '@print-an-agent/base-request';
import { parseTurnId, supportsSessionExecution } from '@print-an-agent/base-session';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSharedSqliteStandaloneDefinition,
  createStandaloneDirectoryDefinition,
  type StandaloneAgentConfig,
  type StandaloneRawAgent,
  type StandaloneRuntimePorts,
} from '../../../src/index.js';
import { testMemoryDefinition } from '../../support/owned-setup.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../../support/resource-profile.js';

type ProfileDefinition<THandle> = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  THandle,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
>;

function requireInspectableJournal(
  journal: RequestJournalPort
): asserts journal is InspectableRequestJournalPort {
  if (!('inspect' in journal) || typeof journal.inspect !== 'function') {
    throw new Error('Official profiles must expose an inspectable Request Journal.');
  }
}

async function verifySharedAuthority<THandle>(
  definition: ProfileDefinition<THandle>,
  reopenDefinition: () => ProfileDefinition<THandle>
): Promise<void> {
  const agents = createAgentManagementService(definition);
  const agentId = parseAgentId('owner');
  await agents.create({ identity: { id: agentId }, config: resourceProfileConfig() });
  await expect(
    agents.create({ identity: { id: agentId }, config: resourceProfileConfig() })
  ).rejects.toMatchObject({ code: 'MANAGED_AGENT_ALREADY_EXISTS' });
  const runtime = await createAgentRuntimeService(definition).open(agentId);
  const initialSession = await runtime.resources.session.resolve({ agentId });
  const completed = await runtime.invoke('foreground', {
    message: 'completed',
    sessionId: initialSession.sessionId,
    idempotencyKey: 'completed',
  });
  const reference = { agentId, sessionId: completed.sessionId };
  const session = runtime.resources.session;
  const journal = runtime.resources.requestJournal;
  if (!supportsSessionExecution(session))
    throw new Error('Expected coordinated execution support.');
  requireInspectableJournal(journal);
  const execution = await session.acquireSessionExecution(reference);
  const resolved = await session.resolve(reference);
  await session.beginTurn({
    ...resolved,
    execution,
    turnId: parseTurnId('unfinished'),
    userMessage: { role: 'user', text: 'unfinished', timestamp: 100 },
  });
  const pending = {
    ...reference,
    execution,
    idempotencyKey: parseRequestIdempotencyKey('unfinished'),
    fingerprint: createRequestFingerprint({ message: 'unfinished' }),
    requestId: 'unfinished',
  };
  await journal.claim(pending);

  // Durable profiles reopen adapters; Memory consumers reuse the same provisioning scope.
  const sibling = reopenDefinition();
  await createAgentManagementService(sibling).disable({ agentId, expectedIdentityRevision: 1 });
  const sessions = createSessionManagementService(
    defineManagedAgentComposition({
      ...sibling,
      authority: {
        createPorts: () => {
          throw new Error('Session management must not acquire authority ports.');
        },
      },
      runtime: {
        ...sibling.runtime,
        createPorts: () => {
          throw new Error('Session management must not acquire runtime ports.');
        },
      },
    })
  );
  const inspection = await sessions.inspect(reference);
  if (inspection === undefined)
    throw new Error('Expected the runtime Session in the sibling Service.');
  expect(inspection.execution.activeLeaseCount).toBe(1);
  await expect(sessions.retire({ ...reference, expectedRevision: 0 })).rejects.toMatchObject({
    code: 'SESSION_BUSY',
  });
  await expect(
    sessions.recover({ ...reference, expectedExecutionRevision: 0 })
  ).rejects.toMatchObject({ code: 'SESSION_EXECUTION_CONFLICT' });
  await sessions.recover({
    ...reference,
    expectedExecutionRevision: inspection.execution.revision,
  });

  expect((await sessions.listTurns(reference))?.records.map((turn) => turn.status).sort()).toEqual([
    'completed',
    'failed',
  ]);
  expect(await journal.inspect(pending)).toMatchObject({ status: 'failed' });
  const completedReference = {
    ...reference,
    idempotencyKey: parseRequestIdempotencyKey('completed'),
  };
  expect(await journal.inspect(completedReference)).toMatchObject({ status: 'completed' });
  await expect(
    journal.fail({ ...pending, failure: { code: 'late', message: 'stale writer' } })
  ).rejects.toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
  await expect(session.releaseSessionExecution(execution)).rejects.toMatchObject({
    code: 'SESSION_EXECUTION_STALE',
  });
  await expect(createAgentRuntimeService(sibling).open(agentId)).rejects.toMatchObject({
    code: 'MANAGED_AGENT_DISABLED',
  });

  await sessions.retire({ ...reference, expectedRevision: 0 });
  expect((await sessions.list({ agentId })).records).toEqual([]);
  expect((await sessions.listRetired({ agentId })).records).toHaveLength(1);
  await sessions.restore({ ...reference, expectedRevision: 1 });
  await sessions.retire({ ...reference, expectedRevision: 2 });
  await expect(
    sessions.purge({
      ...reference,
      expectedRevision: 2,
      confirmation: 'permanently-delete-session',
    })
  ).rejects.toMatchObject({ code: 'SESSION_METADATA_CONFLICT' });
  expect(await journal.inspect(completedReference)).toMatchObject({ status: 'completed' });
  await sessions.purge({
    ...reference,
    expectedRevision: 3,
    confirmation: 'permanently-delete-session',
  });
  expect(await sessions.inspect(reference)).toBeUndefined();
  expect(await journal.inspect(completedReference)).toBeUndefined();
  expect(await journal.inspect(pending)).toBeUndefined();
}

describe('profile-shared authority and coordinated maintenance', () => {
  it('shares Memory execution fences and both persistence domains with sibling Services', async () => {
    const definition = testMemoryDefinition(resourceProfileRuntimeOptions(() => undefined));
    await verifySharedAuthority(definition, () => definition);
  });

  it.each(['directory', 'shared-sqlite'] as const)(
    'reopens the same %s authority without an object cache',
    async (profile) => {
      const directory = await mkdtemp(join(tmpdir(), 'profile-shared-authority-'));
      const runtimeOptions = resourceProfileRuntimeOptions(() => undefined);
      const sqlite = { tablePrefix: 'profile_' };
      try {
        if (profile === 'directory') {
          const open = () =>
            createStandaloneDirectoryDefinition({
              ...runtimeOptions,
              sqlite,
              rootDirectory: directory,
            });
          await verifySharedAuthority(open(), open);
        } else {
          const open = () =>
            createSharedSqliteStandaloneDefinition({
              ...runtimeOptions,
              sqlite,
              databasePath: join(directory, 'agents.sqlite'),
            });
          await verifySharedAuthority(open(), open);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
});
