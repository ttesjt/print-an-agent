import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
} from '@ta-agent/base-composition';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSharedSqliteStandaloneDefinition,
  createStandaloneDirectoryDefinition,
  defineStandaloneAgentConfig,
  type StandaloneAgentConfigInput,
  type StandaloneAgentConfig,
  type StandaloneRawAgent,
  type StandaloneRuntimePorts,
} from '../../src/index.js';

const config: StandaloneAgentConfigInput = {
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
};

async function verifyDefinition<TNamespaceHandle>(
  definition: SessionManagedAgentCompositionDefinition<
    StandaloneAgentConfig,
    TNamespaceHandle,
    StandaloneRuntimePorts,
    StandaloneRawAgent,
    SessionManagementPorts
  >,
  expectedProjection: 'current' | 'not-configured',
  readEnvironmentVariable: ReturnType<typeof vi.fn>
): Promise<void> {
  const management = createAgentManagementService(definition);
  const runtime = createAgentRuntimeService(definition);
  const sessions = createSessionManagementService(definition);

  const created = await management.create({
    identity: { id: 'bro' },
    config: defineStandaloneAgentConfig(config),
  });
  expect(created.projection).toEqual({ kind: expectedProjection });
  expect(readEnvironmentVariable).not.toHaveBeenCalled();

  const first = await runtime.open(created.identity.identity.id);
  const second = await runtime.open(created.identity.identity.id);
  expect(first).not.toBe(second);
  expect(first.identity.id).toBe('bro');
  expect(readEnvironmentVariable).not.toHaveBeenCalled();
  await expect(sessions.list({ agentId: created.identity.identity.id })).resolves.toMatchObject({
    records: [],
  });
}

async function withTemporaryDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'standalone-definition-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Standalone managed profile Definitions', () => {
  it.each(['directory', 'shared-sqlite'] as const)(
    'installs narrow management, runtime, and Session Services for %s',
    async (profile) => {
      await withTemporaryDirectory(async (directory) => {
        const readEnvironmentVariable = vi.fn(() => undefined);
        if (profile === 'directory') {
          await verifyDefinition(
            createStandaloneDirectoryDefinition({
              rootDirectory: directory,
              readEnvironmentVariable,
            }),
            'current',
            readEnvironmentVariable
          );
        } else {
          await verifyDefinition(
            createSharedSqliteStandaloneDefinition({
              databasePath: join(directory, 'agents.sqlite'),
              readEnvironmentVariable,
            }),
            'not-configured',
            readEnvironmentVariable
          );
        }
      });
    }
  );
});
