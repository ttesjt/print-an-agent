import type { RunId } from '@print-an-agent/workbench-domain';

import { WorkbenchControlPlaneError } from '../../foundation/errors.js';

export class ExporterSlotNotFoundError extends WorkbenchControlPlaneError {
  constructor(profileId: string, exporterId: string) {
    super(
      'EXPORTER_SLOT_NOT_FOUND',
      `Exporter "${exporterId}" is not defined by Model Profile "${profileId}".`
    );
  }
}

export class ExportCapabilityError extends WorkbenchControlPlaneError {
  constructor(runId: RunId, options?: ErrorOptions) {
    super(
      'EXPORT_CAPABILITY_ERROR',
      `Exporter Capability for Run "${runId}" did not produce an acceptable terminal result.`,
      options
    );
  }
}

export class ExportArtifactVerificationError extends WorkbenchControlPlaneError {
  constructor(runId: RunId, artifactName: string, artifactId: string, options?: ErrorOptions) {
    super(
      'EXPORT_ARTIFACT_VERIFICATION_ERROR',
      `Artifact "${artifactName}" (${artifactId}) produced by Export Run "${runId}" could not be verified.`,
      options
    );
  }
}
