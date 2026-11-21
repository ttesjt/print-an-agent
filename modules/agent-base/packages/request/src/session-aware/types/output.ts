import type { SessionBranchId, SessionId } from '@print-an-agent/base-session';
import type { ToolRunInspection } from '@print-an-agent/base-tool';
import type { AssistantModelMessage } from '@print-an-agent/model-invocation-core';
import type { OutputFailure, OutputStreamEvent } from '../../output/index.js';

export interface AgentResponse {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly branchId: SessionBranchId;
  readonly message: AssistantModelMessage;
  readonly toolRun: ToolRunInspection;
}

export interface OutputOpenEvent {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly branchId: SessionBranchId;
}

export interface OutputSink {
  open(event: OutputOpenEvent): Promise<void>;
  /** Function-valued contract keeps union acceptance contravariant for typed consumers. */
  readonly write: (event: OutputStreamEvent) => Promise<void>;
  close(response: AgentResponse): Promise<void>;
  fail(failure: OutputFailure): Promise<void>;
}
