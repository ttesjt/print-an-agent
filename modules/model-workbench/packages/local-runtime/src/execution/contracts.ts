import type { JsonObject } from '@print-an-agent/workbench-domain';
import type { ExecutionSupportRuntime } from '@print-an-agent/workbench-extension';

import type { LocalExecutionReceiptKind } from '../foundation/constants.js';

export type LocalFilesystemExecutionReceipt = JsonObject & {
  readonly kind: typeof LocalExecutionReceiptKind.FilesystemRecord;
  readonly executionId: string;
};

export interface LocalExecutionSupportOptions {
  readonly runtimeSupportId: string;
  readonly rootDirectory: string;
}

export type LocalExecutionReceipt = LocalFilesystemExecutionReceipt;
export type LocalExecutionSupport = ExecutionSupportRuntime;
