import type { ArtifactReference } from '@ta-agent/workbench-domain';

import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';

export interface ArtifactVerificationRequest {
  readonly artifact: ArtifactReference;
}

export type VerifyArtifact = (
  request: ArtifactVerificationRequest,
  options?: ExtensionCallOptions
) => Promise<void>;
