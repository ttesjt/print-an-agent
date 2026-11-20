import type { AgentRequestInput, AgentResponse } from '@print-an-agent/base-request';
import type { BaseAgentRunContext } from '@print-an-agent/base-runtime';
import type { CompactSessionInput, SessionCompactionOutcome } from '@print-an-agent/base-session';

export type RequestAgentRunContext = BaseAgentRunContext<AgentRequestInput, AgentResponse>;

export type SessionCompactionAgentRunContext = BaseAgentRunContext<
  CompactSessionInput,
  SessionCompactionOutcome
>;
