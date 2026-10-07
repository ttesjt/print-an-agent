import { DEFAULT_AGENT_CONFIG, type AgentWebConfig } from '../../src/application/agent-config.js';

export function engineConfig(engineId = 'agent-web.offline'): AgentWebConfig {
  return { ...DEFAULT_AGENT_CONFIG, model: { kind: 'engine', engineId } };
}
export function providerConfig(baseUrl: string, model = 'fixture'): AgentWebConfig {
  return {
    ...DEFAULT_AGENT_CONFIG,
    model: {
      kind: 'provider',
      credential: null,
      config: {
        kind: 'openai-compatible',
        reference: { provider: 'local-fixture', model, baseUrl },
        contextWindowTokens: 4096,
        maxOutputTokens: 256,
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole: false },
      },
    },
  };
}
