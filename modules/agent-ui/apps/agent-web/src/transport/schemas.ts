import type { AgentWebConfig } from '../application/agent-config.js';
import { AGENT_CONFIG_DECODER } from '../application/agent-config-validation.js';
import { object, union, literal, text, type Decoder, schemas } from '@ta-agent/ui-transport';
export const {
  id,
  revision,
  timestamp,
  agentSummary,
  agentDetails,
  agentFailure,
  sessionFailure,
  conversationFailure,
  result,
  session,
  sessionPage,
  navigation,
  branchMutation,
  completedTurn,
  conversationPage,
  interactionEvent,
  interactionInput,
} = schemas;
export const config: Decoder<AgentWebConfig> = AGENT_CONFIG_DECODER;
export const modelStatus = object({
  revision,
  status: union(
    literal('unconfigured'),
    literal('configured'),
    literal('credential-unavailable'),
    literal('engine')
  ),
  label: text(512, 1),
});
export const modelConnection = object({ revision, checkedAt: timestamp });
export const configSnapshot = object({ agentId: id, revision, value: config });
export const agentSnapshot = object({ details: agentDetails, config: configSnapshot });
