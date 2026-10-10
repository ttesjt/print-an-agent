import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
} from '@ta-agent/base-composition';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@ta-agent/base-model';
import {
  createSharedSqliteStandaloneManagementService,
  createSharedSqliteStandaloneSessionNavigationService,
  createSharedSqliteStandaloneRuntimeService,
  createSharedSqliteStandaloneSessionService,
  createStandaloneAgent,
  createStandaloneMemoryDefinition,
  defineStandaloneAgentConfig,
  type StandaloneAgentConfigInput,
  type StandaloneRuntimeOptions,
} from '@ta-agent/base-standalone-agent';
import { describe, expect, it } from 'vitest';

function standaloneConfig(
  instructions = 'Answer directly.',
  timeoutMilliseconds: number | null = null
): StandaloneAgentConfigInput {
  return {
    provider: {
      config: {
        kind: 'openai-compatible',
        reference: {
          provider: 'fixture',
          model: 'fixture',
          baseUrl: 'http://127.0.0.1:1/v1',
        },
        contextWindowTokens: 4_096,
        maxOutputTokens: 512,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
    },
    mainActor: { instructions },
    request: { timeoutMilliseconds },
  };
}

function runtimeOptions(onInvocation: () => void): StandaloneRuntimeOptions {
  return {
    readEnvironmentVariable: () => undefined,
    stepOverrides: {
      invokeActorInteraction: async (context) => {
        onInvocation();
        const interaction = context.interaction;
        if (interaction === undefined) throw new Error('Expected interaction scope.');
        const message = defineAssistantModelMessage({
          role: 'assistant',
          text: 'qualified response',
          timestamp: 100,
          stopReason: 'stop',
          provenance: defineEngineDefinedModelExecutionProvenance({
            type: 'application-composition-qualification',
            evidence: {},
          }),
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2,
          },
        });
        await interaction.emit({ type: 'assistant-complete', message });
        interaction.result = { message };
      },
    },
  };
}

describe('public Standalone application composition entry points', () => {
  it('shares one Memory provisioning scope across generic narrow Services and fresh runtimes', async () => {
    let invocationCount = 0;
    const definition = createStandaloneMemoryDefinition(
      runtimeOptions(() => {
        invocationCount += 1;
      })
    );
    const management = createAgentManagementService(definition);
    const runtimes = createAgentRuntimeService(definition);
    const sessions = createSessionManagementService(definition);
    const navigation = createSessionNavigationService(definition);
    const created = await management.create({
      identity: { id: 'memory-consumer' },
      config: defineStandaloneAgentConfig(standaloneConfig()),
    });
    const agentId = created.authority.identity.identity.id;
    const first = await runtimes.open(agentId);
    const response = await first.invoke('foreground', { message: 'remember this' });

    expect(
      (await sessions.listTurns({ agentId, sessionId: response.sessionId }))?.records
    ).toHaveLength(1);
    await expect(
      navigation.inspect({ agentId, sessionId: response.sessionId })
    ).resolves.toMatchObject({ status: 'inspected' });
    await management.updateConfig({
      agentId,
      expectedRevision: 1,
      config: defineStandaloneAgentConfig(standaloneConfig('Updated.', 45_000)),
    });
    const second = await runtimes.open(agentId);
    expect(second).not.toBe(first);
    expect(second.resources.session).toBe(first.resources.session);
    expect(second.resources.requestJournal).toBe(first.resources.requestJournal);
    expect(first.operations.foreground.config.timeoutMilliseconds).toBeNull();
    expect(second.operations.foreground.config.timeoutMilliseconds).toBe(45_000);
    expect(invocationCount).toBe(1);
  });

  it('reopens one shared-SQLite authority across bootstrap and narrow Standalone Services', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-entrypoint-qualification-'));
    const databasePath = join(directory, 'agents.sqlite');
    const sqlite = { tablePrefix: 'qualification_' } as const;
    let invocationCount = 0;
    const options = {
      ...runtimeOptions(() => {
        invocationCount += 1;
      }),
      sqlite,
    };
    const bootstrap = {
      schemaVersion: 1 as const,
      identity: { id: 'durable-consumer' },
      ...standaloneConfig(),
      persistence: { kind: 'sqlite' as const, databasePath },
    };
    try {
      const first = await createStandaloneAgent(bootstrap, options);
      const response = await first.invoke('foreground', { message: 'persist this' });
      const management = createSharedSqliteStandaloneManagementService({ databasePath, sqlite });
      const runtimes = createSharedSqliteStandaloneRuntimeService({
        ...options,
        databasePath,
      });
      const sessions = createSharedSqliteStandaloneSessionService({ databasePath, sqlite });
      const navigation = createSharedSqliteStandaloneSessionNavigationService({
        databasePath,
        sqlite,
      });

      expect((await management.inspect('durable-consumer')).config.revision).toBe(1);
      expect(
        (
          await sessions.listTurns({
            agentId: 'durable-consumer',
            sessionId: response.sessionId,
          })
        )?.records
      ).toHaveLength(1);
      await expect(
        navigation.inspect({
          agentId: 'durable-consumer',
          sessionId: response.sessionId,
        })
      ).resolves.toMatchObject({ status: 'inspected' });
      await expect(createStandaloneAgent(bootstrap, options)).rejects.toMatchObject({
        code: 'MANAGED_AGENT_ALREADY_EXISTS',
      });

      await management.updateConfig({
        agentId: 'durable-consumer',
        expectedRevision: 1,
        config: defineStandaloneAgentConfig(standaloneConfig('Updated.', 60_000)),
      });
      const updated = await runtimes.open('durable-consumer');
      expect(first.operations.foreground.config.timeoutMilliseconds).toBeNull();
      expect(updated.operations.foreground.config.timeoutMilliseconds).toBe(60_000);
      expect(invocationCount).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
