import type { JsonObject } from '@print-an-agent/workbench-domain';
import type { ArtifactHandoffSupportRuntime } from '@print-an-agent/workbench-extension';

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
