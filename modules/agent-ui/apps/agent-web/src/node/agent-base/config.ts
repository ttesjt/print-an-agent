import type { AgentConfigCodec } from '@print-an-agent/base-config';
import type { AgentWebConfig, AgentModelBinding } from '../../application/agent-config.js';
import type { ConfigValue } from '@print-an-agent/base-config';
import { defineAgentWebConfig } from '../../application/agent-config-validation.js';

export const WEB_AGENT_CONFIG_CODEC: AgentConfigCodec<AgentWebConfig> = Object.freeze({
  schemaVersion: 1,
  decode: defineAgentWebConfig,
  encode: (input: AgentWebConfig) => {
    const config = defineAgentWebConfig(input);
    return { ...config, model: encodeModel(config.model), execution: { ...config.execution } };
  },
});

function encodeModel(model: AgentModelBinding): ConfigValue {
  if (model.kind !== 'provider') return { ...model };
  return {
    ...model,
    config: { ...model.config, reference: { ...model.config.reference } },
    credential: model.credential === null ? null : { ...model.credential },
  };
}
