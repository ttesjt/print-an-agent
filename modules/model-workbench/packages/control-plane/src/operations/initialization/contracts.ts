import type { RunId } from '@print-an-agent/workbench-domain';
import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface StartInitializationInput {
  readonly profileId: string;
  readonly initializerId: string;
  readonly input: unknown;
}

export interface StartInitializationResult {
  readonly runId: RunId;
}

export interface InitializationOperations {
  start(
    input: StartInitializationInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartInitializationResult>;
}
