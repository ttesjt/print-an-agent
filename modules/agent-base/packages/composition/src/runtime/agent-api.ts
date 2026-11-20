import type { AgentIdentity } from '@print-an-agent/base-identity-config/identity';
import type { AgentRequestInput, AgentResponse } from '@print-an-agent/base-request';
import type { AgentRunOptions } from '@print-an-agent/base-runtime';
import type { CompactSessionInput, SessionCompactionOutcome } from '@print-an-agent/base-session';
import {
  type ComposedAgent,
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
} from './standard-agent/index.js';

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
