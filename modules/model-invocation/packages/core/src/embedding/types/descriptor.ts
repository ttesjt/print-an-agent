import type { EmbeddingTask } from '../tasks.js';

/** Versioned references are host/implementation commitments, not verified remote weights. */
export interface TextEmbeddingRepresentation {
  readonly modelRef: string;
  readonly dimensions: number;
  readonly preprocessingRef: string;
  readonly documentRecipeRef: string;
  readonly queryRecipeRef: string;
  readonly outputTransformRef: string;
}

/** null means unknown/not locally bounded, never a claim that the model accepts unlimited input. */
export interface TextEmbeddingLimits {
  readonly maxBatchSize: number | null;
  readonly maxInputUtf8Bytes: number | null;
  readonly maxBatchUtf8Bytes: number | null;
}

export interface TextEmbeddingDescriptor {
  readonly representationRef: string;
  readonly representation: TextEmbeddingRepresentation;
  readonly inputKind: 'text';
  readonly tasks: readonly EmbeddingTask[];
  readonly limits: TextEmbeddingLimits;
}
