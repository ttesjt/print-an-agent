import type { JsonValue } from '@ta-agent/workbench-domain';

import type { ExecutionObservation } from '../../execution-protocol/contracts.js';
import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';

export interface ObserveExecutionRequest {
  readonly executionReceipt: JsonValue;
}

export type ObserveExecution = (
  request: ObserveExecutionRequest,
  options?: ExtensionCallOptions
) => Promise<ExecutionObservation<JsonValue>>;

export interface CancelExecutionRequest {
  readonly executionReceipt: JsonValue;
}

export type CancelExecution = (
  request: CancelExecutionRequest,
  options?: ExtensionCallOptions
) => Promise<void>;
