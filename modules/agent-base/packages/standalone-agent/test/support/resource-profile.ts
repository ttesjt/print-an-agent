import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@ta-agent/base-model';
import {
  defineStandaloneAgentConfig,
  type StandaloneAgentConfig,
  type StandaloneRuntimeOptions,
} from '../../src/index.js';

export function resourceProfileConfig(instructions = 'Answer directly.'): StandaloneAgentConfig {
  return defineStandaloneAgentConfig({
    provider: {
      config: {
        kind: 'openai-compatible',
        reference: { provider: 'fixture', model: 'fixture', baseUrl: 'http://127.0.0.1:1/v1' },
        contextWindowTokens: 4_096,
        maxOutputTokens: 512,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
    },
    mainActor: { instructions },
  });
}

/** Exercise the real Request/Session pipeline without making provider output part of the test. */
export function resourceProfileRuntimeOptions(onInvocation: () => void): StandaloneRuntimeOptions {
  return {
    readEnvironmentVariable: () => {
      throw new Error('This resource fixture does not require credentials.');
    },
    stepOverrides: {
      invokeActorInteraction: async (context) => {
        onInvocation();
        const interaction = context.state.interaction;
        if (interaction === undefined) throw new Error('Expected an interaction scope.');
        const message = defineAssistantModelMessage({
          role: 'assistant',
          text: 'resource answer',
          timestamp: 100,
          stopReason: 'stop',
          provenance: defineEngineDefinedModelExecutionProvenance({
            type: 'resource-fixture',
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
