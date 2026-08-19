import type { ModelStateInput, RunId } from '@ta-agent/workbench-domain';

import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface StartTrainingInput {
  readonly profileId: string;
  readonly trainerId: string;
  readonly source: ModelStateInput;
  readonly input: unknown;
}

export interface StartTrainingResult {
  readonly runId: RunId;
}

export interface TrainingOperations {
  start(
    input: StartTrainingInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartTrainingResult>;
}
