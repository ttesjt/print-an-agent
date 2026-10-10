import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  defineProviderModelReference,
} from '@ta-agent/base-model';
import { parseTurnId, supportsSessionExecution } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  createStandaloneDirectoryDefinition,
  type CreateStandaloneDirectoryProfileOptions,
  type StandaloneAgentConfigInput,
  type StandaloneAgentManifestInput,
} from '../../src/index.js';
import { createManagedProfileHarness } from '../support/managed-profile-harness.js';

function createDirectoryProfileHarness(options: CreateStandaloneDirectoryProfileOptions) {
  return createManagedProfileHarness(createStandaloneDirectoryDefinition(options));
}

const TEST_MODEL = defineProviderModelReference({ provider: 'loopback', model: 'test-model' });
const TEST_USAGE = Object.freeze({
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2,
});

function definition(tone = 'Answer directly.'): StandaloneAgentConfigInput {
  return {
    provider: {
      config: {
        kind: 'openai-compatible',
        reference: {
          provider: 'loopback',
          model: 'test-model',
          baseUrl: 'http://127.0.0.1:8080/v1',
          credentialRef: 'credentials/standalone',
        },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
    },
    credential: {
      reference: 'credentials/standalone',
      environmentVariable: 'TA_AGENT_TEST_API_KEY',
    },
    mainActor: {
      instructions: tone,
      invocationConfig: { temperature: 0, maxOutputTokens: 256 },
    },
  };
}

function manifest(id: string, displayName: string): StandaloneAgentManifestInput {
  return {
    schemaVersion: 1,
    identity: { id, displayName },
    config: definition(),
  };
}

async function withTemporaryRoot(action: (rootDirectory: string) => Promise<void>): Promise<void> {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'ta-agent-managed-'));
  try {
    await action(rootDirectory);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

describe('Standalone directory profile', () => {
  it('publishes and lists isolated per-Agent directories and databases', async () => {
    await withTemporaryRoot(async (rootDirectory) => {
      const profile = createDirectoryProfileHarness({
        rootDirectory,
        readEnvironmentVariable: () => 'PRIVATE_RUNTIME_KEY',
        sqlite: { tablePrefix: 'directory_' },
      });
      await profile.create(manifest('mochi', 'Mochi'));
      await profile.create(manifest('bro', 'Bro'));

      const listed = await profile.list();
      expect(listed.map((entry) => entry.identity.identity.id)).toEqual(['bro', 'mochi']);
      for (const agentId of ['bro', 'mochi']) {
        await profile.open(agentId);
        expect((await readdir(join(rootDirectory, agentId))).sort()).toEqual([
          'agent.json',
          'agent.sqlite',
        ]);
        const text = await readFile(join(rootDirectory, agentId, 'agent.json'), 'utf8');
        expect(text).toContain(`"id": "${agentId}"`);
        expect(text).not.toContain('PRIVATE_RUNTIME_KEY');
        expect(text).not.toContain('directory_');
        expect(JSON.parse(text) as unknown).toMatchObject({
          config: {
            provider: {
              transportLivenessPolicy: {
                responseStartTimeoutMilliseconds: null,
                streamEventIdleTimeoutMilliseconds: null,
              },
            },
            mainActor: { invocationPolicy: { timeoutMilliseconds: null } },
            request: { timeoutMilliseconds: null },
            sessionCompaction: { timeoutMilliseconds: null },
          },
        });

        const database = new DatabaseSync(join(rootDirectory, agentId, 'agent.sqlite'));
        const tables = database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all()
          .map((row) => (row as { name: string }).name);
        database.close();
        expect(tables).toEqual([
          'directory_config_schema',
          'directory_configs',
          'directory_identities',
          'directory_identity_schema',
          'directory_request_journal_entries',
          'directory_request_journal_schema',
          'directory_session_branches',
          'directory_session_compactions',
          'directory_session_schema',
          'directory_session_turns',
          'directory_sessions',
        ]);
      }
    });
  });

  it('updates durable config and reconciles a missing or stale manifest on inspect', async () => {
    await withTemporaryRoot(async (rootDirectory) => {
      const profile = createDirectoryProfileHarness({
        rootDirectory,
        readEnvironmentVariable: () => undefined,
      });
      const created = await profile.create(manifest('bro', 'Bro'));
      const updated = await profile.updateConfig({
        agentId: created.authority.identity.identity.id,
        config: definition('Prefer short answers.'),
        expectedRevision: created.authority.config.revision,
      });
      expect(updated).toMatchObject({
        authority: {
          config: {
            revision: 2,
            value: { mainActor: { instructions: 'Prefer short answers.' } },
          },
        },
        projection: { kind: 'current' },
      });

      const manifestPath = join(rootDirectory, 'bro', 'agent.json');
      await writeFile(manifestPath, '{"stale":true}\n', 'utf8');
      const reopened = createDirectoryProfileHarness({
        rootDirectory,
        readEnvironmentVariable: () => undefined,
      });
      await expect(reopened.inspect(created.authority.identity.identity.id)).resolves.toMatchObject(
        {
          config: { revision: 2 },
          projection: { kind: 'current' },
        }
      );
      expect(await readFile(manifestPath, 'utf8')).toContain('Prefer short answers.');

      await unlink(manifestPath);
      await expect(reopened.inspect(created.authority.identity.identity.id)).resolves.toMatchObject(
        {
          projection: { kind: 'current' },
        }
      );
      expect(await readFile(manifestPath, 'utf8')).toContain('Prefer short answers.');
    });
  });

  it('blocks runtime opening while disabled and preserves Session authority after reactivation', async () => {
    await withTemporaryRoot(async (rootDirectory) => {
      let clock = 100;
      const profile = createDirectoryProfileHarness({
        rootDirectory,
        readEnvironmentVariable: () => undefined,
        clock: () => ++clock,
      });
      const created = await profile.create(manifest('bro', 'Bro'));
      const agent = await profile.open(created.authority.identity.identity.id);
      const session = await agent.resources.session.resolve({
        agentId: created.authority.identity.identity.id,
      });
      const turnId = parseTurnId('turn-1');
      const sessionPort = agent.resources.session;
      if (!supportsSessionExecution(sessionPort)) throw new Error('Expected execution capability');
      const execution = await sessionPort.acquireSessionExecution(session);
      await agent.resources.session.beginTurn({
        ...session,
        execution,
        turnId,
        userMessage: { role: 'user', text: 'hello', timestamp: 1 },
      });
      await agent.resources.session.completeTurn({
        ...session,
        execution,
        turnId,
        assistantMessage: defineAssistantModelMessage({
          role: 'assistant',
          text: 'hi',
          provenance: defineProviderModelExecutionProvenance(TEST_MODEL),
          stopReason: 'stop',
          usage: TEST_USAGE,
          timestamp: 2,
        }),
      });

      await sessionPort.releaseSessionExecution(execution);
      const disabled = await profile.disable({
        agentId: created.authority.identity.identity.id,
        expectedRevision: created.authority.identity.revision,
      });
      expect(disabled.authority.identity.status).toBe('disabled');
      await expect(profile.open(created.authority.identity.identity.id)).rejects.toMatchObject({
        code: 'MANAGED_AGENT_DISABLED',
      });

      const active = await profile.reactivate({
        agentId: created.authority.identity.identity.id,
        expectedRevision: disabled.authority.identity.revision,
      });
      expect(active.authority.identity.status).toBe('active');
      const reopened = await profile.open(created.authority.identity.identity.id);
      await expect(reopened.resources.session.inspect(session)).resolves.toMatchObject({
        turns: [{ status: 'completed', userMessage: { text: 'hello' } }],
      });
    });
  });

  it('cleans unpublished staging state after creation fails', async () => {
    await withTemporaryRoot(async (rootDirectory) => {
      const profile = createDirectoryProfileHarness({
        rootDirectory,
        readEnvironmentVariable: () => undefined,
        clock: () => -1,
      });
      await expect(profile.create(manifest('broken', 'Broken'))).rejects.toMatchObject({
        code: 'AGENT_IDENTITY_CONFIGURATION_INVALID',
      });
      expect(await readdir(rootDirectory)).toEqual([]);
    });
  });

  it('fails closed when an Agent ID path is a symbolic link', async () => {
    await withTemporaryRoot(async (rootDirectory) => {
      const outside = await mkdtemp(join(tmpdir(), 'ta-agent-outside-'));
      try {
        await symlink(outside, join(rootDirectory, 'bro'));
        const profile = createDirectoryProfileHarness({
          rootDirectory,
          readEnvironmentVariable: () => undefined,
        });
        await expect(profile.list()).rejects.toMatchObject({
          code: 'MANAGED_AGENT_OPERATION_FAILED',
        });
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('fails closed when the manifest projection is replaced by a symbolic link', async () => {
    await withTemporaryRoot(async (rootDirectory) => {
      const profile = createDirectoryProfileHarness({
        rootDirectory,
        readEnvironmentVariable: () => undefined,
      });
      const created = await profile.create(manifest('bro', 'Bro'));
      const manifestPath = join(rootDirectory, 'bro', 'agent.json');
      await unlink(manifestPath);
      await symlink(join(rootDirectory, 'bro', 'agent.sqlite'), manifestPath);

      await expect(profile.inspect(created.authority.identity.identity.id)).rejects.toMatchObject({
        code: 'MANAGED_AGENT_PROJECTION_FAILED',
      });
    });
  });
});
