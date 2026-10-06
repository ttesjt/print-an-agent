import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@ta-agent/base-model';
import { supportsSessionPresentation, parseTurnId } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  createStandaloneAgent,
  createStandaloneProviderService,
  defineStandaloneAgentConfig,
  createStandaloneDirectoryDefinition,
  createSharedSqliteStandaloneDefinition,
  type StandaloneRuntimeOptions,
  type StandaloneAgentConfigInput,
} from '../../src/index.js';
import { createManagedProfileHarness } from '../support/managed-profile-harness.js';

const definition: StandaloneAgentConfigInput = {
  provider: {
    config: {
      kind: 'openai-compatible',
      reference: { provider: 'fixture', model: 'fixture', baseUrl: 'http://127.0.0.1:1/v1' },
      contextWindowTokens: 4096,
      maxOutputTokens: 512,
      supportsReasoning: false,
      compatibility: { supportsDeveloperRole: false },
    },
    transportLivenessPolicy: {
      responseStartTimeoutMilliseconds: 90_000,
      streamEventIdleTimeoutMilliseconds: 100_000,
    },
  },
  mainActor: { invocationPolicy: { timeoutMilliseconds: 110_000 } },
  request: { timeoutMilliseconds: 120_000 },
  sessionCompaction: { timeoutMilliseconds: 130_000 },
};

describe.each(['explicit', 'directory', 'shared-sqlite'] as const)(
  '%s presentation composition',
  (profile) => {
    it('forwards host Step overrides without storing them in Agent config', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'standalone-presentation-'));
      let captures = 0;
      const options: StandaloneRuntimeOptions = {
        readEnvironmentVariable: () => undefined,
        stepOverrides: {
          invokeActorInteraction: async (context) => {
            const interaction = context.interaction;
            if (interaction === undefined) throw new Error('Expected interaction scope');
            const message = defineAssistantModelMessage({
              role: 'assistant',
              text: 'answer',
              timestamp: 1,
              stopReason: 'stop',
              provenance: defineEngineDefinedModelExecutionProvenance({
                type: 'fixture',
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
            await interaction.emit({ type: 'reasoning-delta', delta: 'secret' });
            await interaction.emit({ type: 'assistant-complete', message });
            interaction.result = { message };
          },
          captureReasoningPresentation: (context) => {
            captures += 1;
            context.capturedReasoning = {
              blocks: [{ modelTurnIndex: 1, chunks: ['[filtered]'] }],
              characterCount: '[filtered]'.length,
            };
            return Promise.resolve();
          },
        },
      };
      try {
        const managedProfile =
          profile === 'directory'
            ? createManagedProfileHarness(
                createStandaloneDirectoryDefinition({ ...options, rootDirectory: directory })
              )
            : profile === 'shared-sqlite'
              ? createManagedProfileHarness(
                  createSharedSqliteStandaloneDefinition({
                    ...options,
                    databasePath: join(directory, 'agents.sqlite'),
                  })
                )
              : undefined;
        if (managedProfile !== undefined)
          await managedProfile.create({
            schemaVersion: 1,
            identity: { id: 'fixture' },
            config: definition,
          });
        const bootstrapAgent =
          managedProfile === undefined
            ? await createStandaloneAgent(
                {
                  schemaVersion: 1,
                  identity: { id: 'fixture' },
                  ...definition,
                  persistence: { kind: 'memory' },
                },
                options
              )
            : undefined;
        const agent = bootstrapAgent ?? (await managedProfile?.open('fixture'));
        if (agent === undefined) throw new Error('Expected a materialized Agent');
        const response = await agent.invoke('foreground', { message: 'hello' });
        expect(captures).toBe(1);
        expect(agent.operations.foreground.config.timeoutMilliseconds).toBe(120_000);
        expect(agent.operations.compactSession.config.timeoutMilliseconds).toBe(130_000);
        if (bootstrapAgent !== undefined) {
          expect(
            createStandaloneProviderService(
              defineStandaloneAgentConfig(definition),
              options
            ).inspect().transportLivenessPolicy
          ).toEqual({
            responseStartTimeoutMilliseconds: 90_000,
            streamEventIdleTimeoutMilliseconds: 100_000,
          });
        }
        const session = agent.resources.session;
        if (!supportsSessionPresentation(session))
          throw new Error('Expected official Session presentation support');
        const record = await session.readTurnPresentation({
          agentId: agent.identity.id,
          sessionId: response.sessionId,
          turnId: parseTurnId(response.requestId),
        });
        expect(record?.presentation.reasoningBlocks).toEqual([
          { modelTurnIndex: 1, text: '[filtered]' },
        ]);
        if (managedProfile !== undefined) {
          const durableConfig = (await managedProfile.inspect('fixture')).config.value;
          expect(durableConfig.mainActor.invocationPolicy.timeoutMilliseconds).toBe(110_000);
          expect(JSON.stringify(durableConfig)).not.toContain('stepOverrides');
          expect(JSON.stringify(durableConfig)).not.toContain('requestPolicy');
          const reopened = (await managedProfile.open('fixture')).resources.session;
          if (!supportsSessionPresentation(reopened))
            throw new Error('Expected reopened presentation support');
          expect(
            await reopened.readTurnPresentation({
              agentId: agent.identity.id,
              sessionId: response.sessionId,
              turnId: parseTurnId(response.requestId),
            })
          ).toEqual(record);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
);
