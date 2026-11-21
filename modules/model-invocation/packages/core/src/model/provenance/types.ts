import type { ProviderId, ProviderModelId } from '../provider/index.js';

declare const modelExecutionProvenanceTypeBrand: unique symbol;

export type ModelExecutionProvenanceType = string & {
  readonly [modelExecutionProvenanceTypeBrand]: 'ModelExecutionProvenanceType';
};

export type ModelExecutionEvidenceValue =
  | null
  | string
  | number
  | boolean
  | readonly ModelExecutionEvidenceValue[]
  | Readonly<{ [key: string]: ModelExecutionEvidenceValue }>;

export type ModelExecutionEvidence = Readonly<{
  [key: string]: ModelExecutionEvidenceValue;
}>;

export interface ProviderModelExecutionProvenance {
  readonly kind: 'provider-model';
  readonly provider: ProviderId;
  readonly model: ProviderModelId;
}

export interface EngineDefinedModelExecutionProvenance {
  readonly kind: 'engine-defined';
  readonly type: ModelExecutionProvenanceType;
  readonly evidence: ModelExecutionEvidence;
}

export type ModelExecutionProvenance =
  | ProviderModelExecutionProvenance
  | EngineDefinedModelExecutionProvenance;
