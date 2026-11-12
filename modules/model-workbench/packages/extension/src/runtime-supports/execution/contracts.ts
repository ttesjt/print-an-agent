import type { JsonValue, ProfileId } from '@print-an-agent/workbench-domain';

import type { ExecutionObservation } from '../../execution-protocol/contracts.js';
import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';

export interface ObserveExecutionRequest {
  readonly profileId: ProfileId;
  readonly executionReceipt: JsonValue;
}

export type ObserveExecution = (
  request: ObserveExecutionRequest,
  options?: ExtensionCallOptions
) => Promise<ExecutionObservation<JsonValue>>;

export interface CancelExecutionRequest {
  readonly profileId: ProfileId;
  readonly executionReceipt: JsonValue;
}

export type CancelExecution = (
  request: CancelExecutionRequest,
  options?: ExtensionCallOptions
) => Promise<void>;
