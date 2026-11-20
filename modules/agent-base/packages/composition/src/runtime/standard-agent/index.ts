export { composeAgent, type ComposedAgent } from './compose-agent.js';
export {
  createStandardAgentDefinition,
  type StandardAgentDefinition,
  type StandardAgentOperations,
  type StandardAgentResources,
} from './create-definition.js';
export { AgentCompositionError, type AgentCompositionErrorCode } from './errors.js';
export {
  composeAgentWithExtensions,
  type AgentCompositionExtension,
  type AgentCompositionExtensionFactory,
} from './extensions.js';
export {
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
} from './names.js';
export { type ComposeAgentOptions } from './types/options.js';
export {
  type RequestAgentRunContext,
  type SessionCompactionAgentRunContext,
} from './types/run-context.js';
