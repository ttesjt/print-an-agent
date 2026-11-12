import { testMemoryDefinition } from '../support/owned-setup.js';
import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
} from '@print-an-agent/base-composition';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionId } from '@print-an-agent/base-session';
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

it('rejects malformed host tokenization before creating a resource namespace', () => {
  expect(() =>
    testMemoryDefinition({
      readEnvironmentVariable: () => undefined,
      sessionCompactionTokenCounter: {
        descriptor: {
          measurementRef: '   ',
          inputProtocolRef: 'token-input:text',
          scope: 'text',
          inputKinds: ['text'],
        },
        measure: () =>
          Promise.resolve({
            tokens: 1,
            accuracy: 'exact',
            measurementRef: '   ',
            inputProtocolRef: 'token-input:text',
            scope: 'text',
          }),
      },
    })
  ).toThrow();
});

async function verifyDefinition<TNamespaceHandle>(
  definition: SessionManagedAgentCompositionDefinition<
    StandaloneAgentConfig,
    TNamespaceHandle,
    StandaloneRuntimePorts,
    StandaloneRawAgent,
    SessionManagementPorts
  > &
    SessionNavigationCapability<TNamespaceHandle, SessionNavigationPorts>,
  expectedProjection: 'current' | 'not-configured',
  readEnvironmentVariable: ReturnType<typeof vi.fn>
): Promise<void> {
  const management = createAgentManagementService(definition);
  const runtime = createAgentRuntimeService(definition);
  const sessions = createSessionManagementService(definition);
  const navigation = createSessionNavigationService(definition);

  const created = await management.create({
    identity: { id: 'bro' },
    config: defineStandaloneAgentConfig(config),
  });
  expect(created.projection).toEqual({ kind: expectedProjection });
  expect(readEnvironmentVariable).not.toHaveBeenCalled();

  const first = await runtime.open(created.authority.identity.identity.id);
  const second = await runtime.open(created.authority.identity.identity.id);
  expect(first).not.toBe(second);
  expect(first.identity.id).toBe('bro');
  expect(readEnvironmentVariable).not.toHaveBeenCalled();
  await expect(
    sessions.list({ agentId: created.authority.identity.identity.id })
  ).resolves.toMatchObject({
    records: [],
  });
  await expect(
    navigation.inspect({
      agentId: created.authority.identity.identity.id,
      sessionId: parseSessionId('missing-session'),
    })
  ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
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
  it('installs the same narrow Services over a shared Memory provisioning scope', async () => {
    const readEnvironmentVariable = vi.fn(() => undefined);
    await verifyDefinition(
      testMemoryDefinition({ readEnvironmentVariable }),
      'not-configured',
      readEnvironmentVariable
    );
  });

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
