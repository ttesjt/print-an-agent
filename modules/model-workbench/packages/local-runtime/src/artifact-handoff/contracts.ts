import type { JsonObject } from '@ta-agent/workbench-domain';
import type { ArtifactHandoffSupportRuntime } from '@ta-agent/workbench-extension';

import type {
  LocalArtifactMaterializationKind,
  LocalArtifactReceiptKind,
} from '../foundation/constants.js';

export type LocalDirectoryArtifactReceipt = JsonObject & {
  readonly kind: typeof LocalArtifactReceiptKind.Directory;
  readonly relativePath: string;
};

export type LocalDirectoryArtifactMaterialization = JsonObject & {
  readonly kind: typeof LocalArtifactMaterializationKind.Directory;
  readonly directory: string;
  readonly access: 'read-only';
};

export interface LocalArtifactHandoffSupportOptions {
  readonly runtimeSupportId: string;
  readonly rootDirectory: string;
}

export interface LocalArtifactDigestOptions {
  readonly signal?: AbortSignal;
}

export type LocalArtifactHandoffSupport = ArtifactHandoffSupportRuntime;
