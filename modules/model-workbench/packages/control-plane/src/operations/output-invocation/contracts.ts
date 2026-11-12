import type {
  JsonValue,
  OutputId,
  OutputInvokerId,
  ProfileId,
  Sha256Digest,
} from '@print-an-agent/workbench-domain';
import { OutputInvocationKind } from '@print-an-agent/workbench-extension';

import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface InvokeOutputInput {
  readonly profileId: string;
  readonly outputId: string;
  /** Omit to invoke the Profile's canonical Output Invoker. */
  readonly outputInvokerId?: string;
  readonly input: unknown;
}

export interface ResolveOutputInvocationInput {
  readonly profileId: string;
  readonly outputId: string;
}

export const OutputInvocationTargetEvidenceKind = 'output-invocation-target' as const;

/** A stable description of the exact Output and Invoker selected by Workbench. */
export interface OutputInvocationTargetEvidence {
  readonly kind: typeof OutputInvocationTargetEvidenceKind;
  readonly profileId: ProfileId;
  readonly outputId: OutputId;
  readonly outputInvokerId: OutputInvokerId;
  readonly evidenceDigest: Sha256Digest;
}

export interface CompletedOutputInvocation {
  readonly kind: typeof OutputInvocationKind.Completed;
  readonly evidence: OutputInvocationTargetEvidence;
  readonly result: JsonValue;
}

export interface StreamingOutputInvocation {
  readonly kind: typeof OutputInvocationKind.Streaming;
  /** Available before the caller begins consuming the stream. */
  readonly evidence: OutputInvocationTargetEvidence;
  readonly stream: AsyncIterable<JsonValue>;
}

export type OutputInvocation = CompletedOutputInvocation | StreamingOutputInvocation;

export interface OutputInvocationOperations {
  resolve(
    input: ResolveOutputInvocationInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<OutputInvocationTargetEvidence>;
  invoke(
    input: InvokeOutputInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<OutputInvocation>;
}
