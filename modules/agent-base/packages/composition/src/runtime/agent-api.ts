import type { AgentIdentity } from '@ta-agent/base-identity';
import type { CompactSessionInput, SessionCompactionOutcome } from '@ta-agent/base-session';
import type { AgentRequestInput, AgentResponse } from '@ta-agent/base-request';
import type { AgentRunOptions } from '@ta-agent/base-runtime';
import {
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
  type ComposedAgent,
} from './compose-agent.js';

export interface AgentAPI {
  readonly agent: ComposedAgent;
  readonly identity: AgentIdentity;
  readonly operationNames: readonly string[];
  readonly workflowNames: readonly string[];
  run(input: AgentRequestInput, options?: AgentRunOptions): Promise<AgentResponse>;
  compactSession(
    input: CompactSessionInput,
    options?: AgentRunOptions
  ): Promise<SessionCompactionOutcome>;
}

export function createAgentAPI(agent: ComposedAgent): AgentAPI {
  return Object.freeze({
    agent,
    identity: agent.identity,
    operationNames: agent.operationNames,
    workflowNames: agent.workflowCatalog.names,
    run: (input: AgentRequestInput, options: AgentRunOptions = {}) =>
      agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, input, options),
    compactSession: (input: CompactSessionInput, options: AgentRunOptions = {}) =>
      agent.invoke(SESSION_COMPACTION_AGENT_OPERATION_NAME, input, options),
  });
}
