import type { SessionId } from '@print-an-agent/base-session';
import type { RequestIdempotencyKey } from '../../replay/index.js';
import type { OutputSink } from './output.js';

export interface AgentRequestInput {
  readonly message: string;
  /** Existing Session identity. Omit to create; never a requested name for a new Session. */
  readonly sessionId?: string;
  readonly idempotencyKey?: string;
  readonly outputSink?: OutputSink;
}

export interface ValidatedAgentRequest {
  readonly message: string;
  readonly sessionId?: SessionId;
  readonly idempotencyKey?: RequestIdempotencyKey;
  readonly outputSink: OutputSink;
}
