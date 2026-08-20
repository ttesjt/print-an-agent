import {
  type JsonValue,
  type ModelOutput,
  type OutputArtifactName,
  type ProfileId,
} from '@ta-agent/workbench-domain';

import { OutputInvocationKind } from './constants.js';
import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';
import type { ArtifactMaterialization } from '../../runtime-supports/artifact-handoff/contracts.js';

export interface MaterializedOutputArtifact {
  readonly name: OutputArtifactName;
  readonly artifact: ArtifactMaterialization;
}

/** Exact Output identity plus transient Artifact inputs prepared for one invocation. */
export interface MaterializedModelOutput {
  readonly output: ModelOutput;
  readonly artifacts: readonly MaterializedOutputArtifact[];
}

export interface OutputInvocationCapabilityRequest<TInput = JsonValue> {
  readonly profileId: ProfileId;
  readonly target: MaterializedModelOutput;
  readonly input: TInput;
}

export interface CompletedOutputInvocation<TResult = JsonValue> {
  readonly kind: typeof OutputInvocationKind.Completed;
  readonly result: TResult;
}

export interface StreamingOutputInvocation<TResult = JsonValue> {
  readonly kind: typeof OutputInvocationKind.Streaming;
  readonly stream: AsyncIterable<TResult>;
}

export type OutputInvocation<TResult = JsonValue> =
  | CompletedOutputInvocation<TResult>
  | StreamingOutputInvocation<TResult>;

/**
 * Invokes one materialized Output. Cancellation remains cooperative for the full stream lifetime:
 * implementations that return a stream must continue observing the supplied AbortSignal.
 */
export type InvokeOutputCapability<TInput = JsonValue> = (
  request: OutputInvocationCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<OutputInvocation<JsonValue>>;
