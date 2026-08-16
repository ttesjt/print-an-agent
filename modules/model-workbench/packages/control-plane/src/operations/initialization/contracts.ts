import type { BaseId, ExecutionFailure, RunId } from '@ta-agent/workbench-domain';
import { CapabilityOutcomeStatus } from '@ta-agent/workbench-extension';

export interface StartInitializationInput {
  readonly profileId: string;
  readonly initializerId: string;
  readonly input: unknown;
}

export interface ModelWorkbenchOperationOptions {
  readonly signal?: AbortSignal;
}

export type StartInitializationResult =
  | {
      readonly status: typeof CapabilityOutcomeStatus.Succeeded;
      readonly runId: RunId;
      readonly baseId: BaseId;
    }
  | {
      readonly status: typeof CapabilityOutcomeStatus.Failed;
      readonly runId: RunId;
      readonly failure: ExecutionFailure;
    };

export interface InitializationOperations {
  start(
    input: StartInitializationInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartInitializationResult>;
}
