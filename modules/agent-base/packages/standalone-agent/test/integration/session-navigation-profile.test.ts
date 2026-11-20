import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { SqliteSessionAdapter } from '@print-an-agent/base-local-adapters';
import { DEFAULT_SESSION_BRANCH_ID } from '@print-an-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  createSharedSqliteStandaloneDefinition,
  createSharedSqliteStandaloneSessionNavigationService,
  createStandaloneDirectoryDefinition,
  createStandaloneDirectorySessionNavigationService,
  type StandaloneAgentManifestInput,
} from '../../src/index.js';
import { createManagedProfileHarness } from '../support/managed-profile-harness.js';

function manifest(agentId: string): StandaloneAgentManifestInput {
  return {
    schemaVersion: 1,
    identity: { id: agentId },
    config: {
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: {
            provider: 'loopback',
            model: 'test-model',
            baseUrl: 'http://127.0.0.1:8080/v1',
          },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
      },
    },
  };
}

async function withTemporaryDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'standalone-navigation-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Standalone Session navigation profiles', () => {
  it('reopens a directory Agent Session without materializing its runtime', async () => {
    await withTemporaryDirectory(async (rootDirectory) => {
      const definition = createStandaloneDirectoryDefinition({
        rootDirectory,
        readEnvironmentVariable: () => {
          throw new Error('Navigation must not load provider credentials.');
        },
      });
      await createManagedProfileHarness(definition).create(manifest('directory-owner'));
      const databasePath = join(rootDirectory, 'directory-owner', 'agent.sqlite');
      const session = new SqliteSessionAdapter({ databasePath });
      const resolved = await session.resolve({
        agentId: parseAgentId('directory-owner'),
      });
      const navigation = createStandaloneDirectorySessionNavigationService({ rootDirectory });

      await expect(
        navigation.inspect({ agentId: 'directory-owner', sessionId: resolved.sessionId })
      ).resolves.toMatchObject({
        status: 'inspected',
        navigation: { selectedBranchId: DEFAULT_SESSION_BRANCH_ID, revision: 0 },
      });
      await expect(
        navigation.select({
          agentId: 'directory-owner',
          sessionId: resolved.sessionId,
          branchId: DEFAULT_SESSION_BRANCH_ID,
          expectedRevision: 0,
        })
      ).resolves.toMatchObject({
        status: 'selected',
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        revision: 1,
      });
    });
  });

  it('keeps shared-SQLite navigation scoped by Agent identity', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'agents.sqlite');
      const definition = createSharedSqliteStandaloneDefinition({
        databasePath,
        readEnvironmentVariable: () => undefined,
      });
      const harness = createManagedProfileHarness(definition);
      await harness.create(manifest('first-agent'));
      await harness.create(manifest('second-agent'));
      const session = new SqliteSessionAdapter({ databasePath });
      const first = await session.resolve({ agentId: parseAgentId('first-agent') });
      const second = await session.resolve({ agentId: parseAgentId('second-agent') });
      const navigation = createSharedSqliteStandaloneSessionNavigationService({ databasePath });

      await expect(
        navigation.inspect({ agentId: 'first-agent', sessionId: first.sessionId })
      ).resolves.toMatchObject({ status: 'inspected' });
      await expect(
        navigation.inspect({ agentId: 'first-agent', sessionId: second.sessionId })
      ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
      await expect(
        navigation.select({
          agentId: 'missing-agent',
          sessionId: first.sessionId,
          branchId: DEFAULT_SESSION_BRANCH_ID,
          expectedRevision: 0,
        })
      ).rejects.toMatchObject({ code: 'MANAGED_AGENT_NOT_FOUND' });
    });
  });
});
