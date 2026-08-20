import {
  cancelModelRun,
  defineModelOutput,
  failModelRun,
  loseModelRun,
  ModelOperationKind,
  parseArtifactId,
  parseArtifactReference,
  parseOutputId,
  succeedExportRun,
  type ActiveExportRun,
  type ArtifactReference,
  type ExecutionFailure,
  type ExportLineage,
  type NamedOutputArtifact,
  type TerminalExportRun,
} from '@ta-agent/workbench-domain';
import {
  ExecutionStatus,
  type ExecutionTerminal,
  type ExportCapabilityResult,
  type ExportedArtifact,
} from '@ta-agent/workbench-extension';
import type { ExportCommitter } from '@ta-agent/workbench-persistence';
import type { ResolvedExporterSlot } from '@ta-agent/workbench-setup';

import { ExportArtifactVerificationError } from './errors.js';
import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';

export interface CompleteExportDependencies {
  readonly exportCommitter: ExportCommitter;
  readonly idSource: WorkbenchIdSource;
}

export async function completeExport(
  dependencies: CompleteExportDependencies,
  run: ActiveExportRun,
  exporter: ResolvedExporterSlot,
  terminal: ExecutionTerminal<ExportCapabilityResult>,
  options?: ModelWorkbenchOperationOptions
): Promise<TerminalExportRun> {
  if (terminal.status === ExecutionStatus.Failed) {
    const failed = failModelRun(run, terminal.failure);
    await dependencies.exportCommitter.commit({ run: failed });
    return failed;
  }
  if (terminal.status === ExecutionStatus.Cancelled) {
    const cancelled = cancelModelRun(run, terminal.reason);
    await dependencies.exportCommitter.commit({ run: cancelled });
    return cancelled;
  }
  if (terminal.status === ExecutionStatus.Lost) {
    const lost = loseModelRun(run, terminal.failure);
    await dependencies.exportCommitter.commit({ run: lost });
    return lost;
  }

  const artifacts = await Promise.all(
    terminal.result.artifacts.map((artifact) =>
      acceptArtifact(dependencies, run, exporter, artifact, options)
    )
  );
  const outputId = parseOutputId(dependencies.idSource.nextId('output'), 'generated.outputId');
  const output = defineModelOutput({
    outputId,
    profileId: run.profileId,
    artifacts,
    lineage: defineExportLineage(run),
  });
  const succeeded = succeedExportRun(run, outputId, terminal.result.data);
  await dependencies.exportCommitter.commit({ run: succeeded, output });
  return succeeded;
}

export async function recordExportFailure(
  exportCommitter: ExportCommitter,
  run: ActiveExportRun,
  failure: ExecutionFailure
): Promise<void> {
  try {
    await exportCommitter.commit({ run: failModelRun(run, failure) });
  } catch {
    // The persistence adapter owns reconciliation. Preserve the original execution error.
  }
}

async function acceptArtifact(
  dependencies: CompleteExportDependencies,
  run: ActiveExportRun,
  exporter: ResolvedExporterSlot,
  result: ExportedArtifact,
  options?: ModelWorkbenchOperationOptions
): Promise<NamedOutputArtifact> {
  const artifactId = parseArtifactId(
    dependencies.idSource.nextId('artifact'),
    'generated.artifactId'
  );
  const support = exporter.runtime.supports.artifactHandoff;
  const artifact: ArtifactReference = parseArtifactReference({
    artifactId,
    digest: result.artifact.digest,
    handoff: {
      runtimeSupportId: support.runtimeSupportId,
      receipt: result.artifact.receipt,
    },
  });
  try {
    await support.verify(Object.freeze({ profileId: run.profileId, artifact }), options);
    return Object.freeze({ name: result.name, artifact });
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new ExportArtifactVerificationError(run.runId, result.name, artifactId, { cause });
  }
}

function defineExportLineage(run: ActiveExportRun): ExportLineage {
  return Object.freeze({
    kind: ModelOperationKind.Export,
    runId: run.runId,
    exporterId: run.exporterId,
    capabilityId: run.capabilityId,
    runtimeBindingId: run.runtimeBindingId,
    slotEvidenceDigest: run.slotEvidenceDigest,
    source: run.source,
  });
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
