import type { ToolDescriptor } from '@print-an-agent/model-invocation-core';
import type { ToolCallId, ToolName } from '../../types/identity.js';

export type ToolRunRecordStatus = 'success' | 'handler-error' | 'rejected';

export interface ToolRunRecord {
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly status: ToolRunRecordStatus;
  readonly resultCharacters: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly errorCode?: string;
}

export interface ToolRunInspection {
  readonly status: 'open' | 'closed';
  readonly effectiveTools: readonly ToolDescriptor[];
  readonly records: readonly ToolRunRecord[];
  readonly totalResultCharacters: number;
}
