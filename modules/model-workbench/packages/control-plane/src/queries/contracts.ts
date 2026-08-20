import type {
  ModelBase,
  ModelModification,
  ModelOutput,
  ModelRun,
  ModelState,
  ModelStateInput,
  RunId,
  TerminalModelRun,
} from '@ta-agent/workbench-domain';
import type { ModelWorkbenchOperationOptions } from '../execution/contracts.js';

export interface WaitForRunOptions extends ModelWorkbenchOperationOptions {
  readonly pollIntervalMilliseconds?: number;
}

export interface RunControls {
  get(reference: RunReferenceInput): Promise<ModelRun | undefined>;
  refresh(
    reference: RunReferenceInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<ModelRun>;
  wait(reference: RunReferenceInput, options?: WaitForRunOptions): Promise<TerminalModelRun>;
  cancel(reference: RunReferenceInput, options?: ModelWorkbenchOperationOptions): Promise<RunId>;
}

export interface RunReferenceInput {
  readonly profileId: string;
  readonly runId: string;
}

export interface ModelAssetQueries {
  compose(input: ModelStateInput): ModelState;
  getBase(reference: BaseReferenceInput): Promise<ModelBase | undefined>;
  getModification(reference: ModificationReferenceInput): Promise<ModelModification | undefined>;
}

export interface OutputQueries {
  get(reference: OutputReferenceInput): Promise<ModelOutput | undefined>;
}

export interface BaseReferenceInput {
  readonly profileId: string;
  readonly baseId: string;
}

export interface ModificationReferenceInput {
  readonly profileId: string;
  readonly modificationId: string;
}

export interface OutputReferenceInput {
  readonly profileId: string;
  readonly outputId: string;
}
