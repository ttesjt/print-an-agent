import type { ModelStateInput, RunId } from '@print-an-agent/workbench-domain';

import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface StartExportInput {
  readonly profileId: string;
  readonly exporterId: string;
  readonly source: ModelStateInput;
  readonly input: unknown;
}

export interface StartExportResult {
  readonly runId: RunId;
}

export interface ExportOperations {
  start(
    input: StartExportInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartExportResult>;
}
