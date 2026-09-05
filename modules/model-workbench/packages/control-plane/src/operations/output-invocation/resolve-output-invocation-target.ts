import {
  deriveEvidenceDigest,
  parseJsonValue,
  parseOutputId,
  parseOutputInvokerId,
  parseProfileId,
  type ArtifactId,
  type ModelOutput,
  type RuntimeSupportId,
  type Sha256Digest,
} from '@ta-agent/workbench-domain';
import type { OutputRepository } from '@ta-agent/workbench-persistence';
import {
  findProfileArtifactHandoffSupport,
  findResolvedCanonicalOutputInvoker,
  findResolvedOutputInvoker,
  type ResolvedModelProfile,
  type ResolvedOutputInvokerSlot,
} from '@ta-agent/workbench-setup';

import {
  OutputInvocationTargetEvidenceKind,
  type OutputInvocationTargetEvidence,
  type ResolveOutputInvocationInput,
} from './contracts.js';
import {
  CanonicalOutputInvokerAmbiguousError,
  CanonicalOutputInvokerUnavailableError,
  ModelOutputMismatchError,
  ModelOutputNotFoundError,
  ModelOutputProfileMismatchError,
  OutputInvocationArtifactSupportNotFoundError,
  OutputInvocationArtifactVerificationError,
  OutputInvokerSlotNotFoundError,
} from './errors.js';
import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface ResolvedOutputInvocationTarget {
  readonly output: ModelOutput;
  readonly outputInvoker: ResolvedOutputInvokerSlot;
  readonly evidence: OutputInvocationTargetEvidence;
}

export interface OutputInvocationTargetResolver {
  resolve(
    input: OutputInvocationTargetSelectionInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<ResolvedOutputInvocationTarget>;
}

export interface OutputInvocationTargetSelectionInput extends ResolveOutputInvocationInput {
  readonly outputInvokerId?: string;
}

interface VerifiedArtifactHandoffSupportEvidence {
  readonly artifactId: ArtifactId;
  readonly runtimeSupportId: RuntimeSupportId;
  readonly evidenceDigest: Sha256Digest;
}

export function createOutputInvocationTargetResolver(
  profile: ResolvedModelProfile,
  outputs: OutputRepository
): OutputInvocationTargetResolver {
  return Object.freeze({
    resolve: async (
      input: OutputInvocationTargetSelectionInput,
      options?: ModelWorkbenchOperationOptions
    ) => {
      assertNotAborted(options?.signal);
      const profileId = parseProfileId(input.profileId, 'outputInvocation.profileId');
      const outputId = parseOutputId(input.outputId, 'outputInvocation.outputId');
      const output = await outputs.findOutput(outputId);
      if (output === undefined) throw new ModelOutputNotFoundError(outputId);
      if (output.outputId !== outputId) {
        throw new ModelOutputMismatchError(outputId, output.outputId);
      }
      if (output.profileId !== profileId) {
        throw new ModelOutputProfileMismatchError(outputId, profileId, output.profileId);
      }
      if (profile.profileId !== profileId) {
        throw new ModelOutputProfileMismatchError(outputId, profile.profileId, profileId);
      }

      const outputInvoker = selectOutputInvoker(profile, input.outputInvokerId);
      const artifactHandoffSupports = await verifyOutputArtifacts(profile, output, options);

      const evidence = defineTargetEvidence(output, outputInvoker, artifactHandoffSupports);
      return Object.freeze({ output, outputInvoker, evidence });
    },
  });
}

function selectOutputInvoker(
  profile: ResolvedModelProfile,
  inputOutputInvokerId: string | undefined
): ResolvedOutputInvokerSlot {
  if (inputOutputInvokerId === undefined) return requireCanonicalOutputInvoker(profile);
  const outputInvokerId = parseOutputInvokerId(
    inputOutputInvokerId,
    'outputInvocation.outputInvokerId'
  );
  const outputInvoker = findResolvedOutputInvoker(profile, outputInvokerId);
  if (outputInvoker === undefined) {
    throw new OutputInvokerSlotNotFoundError(profile.profileId, outputInvokerId);
  }
  return outputInvoker;
}

function requireCanonicalOutputInvoker(profile: ResolvedModelProfile): ResolvedOutputInvokerSlot {
  const outputInvoker = findResolvedCanonicalOutputInvoker(profile);
  if (outputInvoker !== undefined) return outputInvoker;
  if (profile.outputInvokers.length > 1) {
    throw new CanonicalOutputInvokerAmbiguousError(profile.profileId);
  }
  throw new CanonicalOutputInvokerUnavailableError(profile.profileId);
}

async function verifyOutputArtifacts(
  profile: ResolvedModelProfile,
  output: ModelOutput,
  options: ModelWorkbenchOperationOptions | undefined
): Promise<readonly VerifiedArtifactHandoffSupportEvidence[]> {
  return Object.freeze(
    await Promise.all(
      output.artifacts.map(async ({ artifact }) => {
        const support = findProfileArtifactHandoffSupport(
          profile,
          artifact.handoff.runtimeSupportId
        );
        if (support === undefined) {
          throw new OutputInvocationArtifactSupportNotFoundError(
            output.outputId,
            artifact.artifactId,
            artifact.handoff.runtimeSupportId
          );
        }
        try {
          await support.verify(Object.freeze({ profileId: profile.profileId, artifact }), options);
        } catch (cause: unknown) {
          if (isAbortError(cause)) throw cause;
          throw new OutputInvocationArtifactVerificationError(
            output.outputId,
            artifact.artifactId,
            { cause }
          );
        }
        return Object.freeze({
          artifactId: artifact.artifactId,
          runtimeSupportId: support.runtimeSupportId,
          evidenceDigest: support.evidenceDigest,
        });
      })
    )
  );
}

function defineTargetEvidence(
  output: ModelOutput,
  outputInvoker: ResolvedOutputInvokerSlot,
  artifactHandoffSupports: readonly VerifiedArtifactHandoffSupportEvidence[]
): OutputInvocationTargetEvidence {
  const evidenceDigest = deriveEvidenceDigest(
    parseJsonValue({
      kind: OutputInvocationTargetEvidenceKind,
      output,
      outputInvoker: {
        outputInvokerId: outputInvoker.outputInvokerId,
        evidenceDigest: outputInvoker.evidenceDigest,
      },
      artifactHandoffSupports,
    })
  );
  return Object.freeze({
    kind: OutputInvocationTargetEvidenceKind,
    profileId: output.profileId,
    outputId: output.outputId,
    outputInvokerId: outputInvoker.outputInvokerId,
    evidenceDigest,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Output invocation target resolution was aborted.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
