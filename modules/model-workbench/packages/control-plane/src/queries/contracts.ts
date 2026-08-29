import type {
  ModelBase,
  ModelModification,
  ModelOutput,
  ModelRun,
  ModelState,
  ModelStateInput,
  ModelOperationKind,
  ModelRunStatus,
  RunId,
  TerminalModelRun,
} from '@ta-agent/workbench-domain';
import type { ModelWorkbenchOperationOptions } from '../execution/contracts.js';

export interface WaitForRunOptions extends ModelWorkbenchOperationOptions {
  readonly pollIntervalMilliseconds?: number;
}

export interface RunControls {
  get(reference: RunReferenceInput): Promise<ModelRun | undefined>;
  list(input: ListRunsInput): Promise<RecordPage<ModelRun>>;
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
  listBases(input: ListModelAssetsInput): Promise<RecordPage<ModelBase>>;
  listModifications(input: ListModelAssetsInput): Promise<RecordPage<ModelModification>>;
}

export interface OutputQueries {
  get(reference: OutputReferenceInput): Promise<ModelOutput | undefined>;
  list(input: ListOutputsInput): Promise<RecordPage<ModelOutput>>;
}

export interface RecordPage<TRecord> {
  readonly records: readonly TRecord[];
  readonly nextCursor?: string;
}

export interface DiscoveryPageInput {
  readonly profileId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListRunsInput extends DiscoveryPageInput {
  readonly operation?: ModelOperationKind;
  readonly status?: ModelRunStatus;
  readonly createdAfter?: string;
  readonly createdBefore?: string;
}

export type ListModelAssetsInput = DiscoveryPageInput;
export type ListOutputsInput = DiscoveryPageInput;

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
