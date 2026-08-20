import {
  parseJsonValue,
  parseOutputId,
  parseOutputInvokerId,
  parseProfileId,
  type JsonValue,
} from '@ta-agent/workbench-domain';
import { OutputInvocationKind, type OutputInvocation } from '@ta-agent/workbench-extension';
import type { OutputRepository } from '@ta-agent/workbench-persistence';
import { findResolvedOutputInvoker, type ResolvedModelProfile } from '@ta-agent/workbench-setup';

import type { InvokeOutputInput } from './contracts.js';
import {
  ModelOutputMismatchError,
  ModelOutputNotFoundError,
  ModelOutputProfileMismatchError,
  OutputInvocationCapabilityError,
  OutputInvokerSlotNotFoundError,
} from './errors.js';
import type { MaterializeOutput } from './materialize-output.js';
import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface InvokeOutputDependencies {
  readonly profile: ResolvedModelProfile;
  readonly outputs: OutputRepository;
  readonly materializeOutput: MaterializeOutput;
}

export function createInvokeOutput(dependencies: InvokeOutputDependencies) {
  return async function invokeOutput(
    input: InvokeOutputInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<OutputInvocation<JsonValue>> {
    assertNotAborted(options?.signal);
    const profileId = parseProfileId(input.profileId, 'outputInvocation.profileId');
    const outputId = parseOutputId(input.outputId, 'outputInvocation.outputId');
    const outputInvokerId = parseOutputInvokerId(
      input.outputInvokerId,
      'outputInvocation.outputInvokerId'
    );
    const invocationInput = parseJsonValue(input.input, 'outputInvocation.input');
    const output = await dependencies.outputs.findOutput(outputId);
    if (output === undefined) throw new ModelOutputNotFoundError(outputId);
    if (output.outputId !== outputId) {
      throw new ModelOutputMismatchError(outputId, output.outputId);
    }
    if (output.profileId !== profileId) {
      throw new ModelOutputProfileMismatchError(outputId, profileId, output.profileId);
    }
    if (dependencies.profile.profileId !== profileId) {
      throw new ModelOutputProfileMismatchError(
        outputId,
        dependencies.profile.profileId,
        profileId
      );
    }
    const outputInvoker = findResolvedOutputInvoker(dependencies.profile, outputInvokerId);
    if (outputInvoker === undefined) {
      throw new OutputInvokerSlotNotFoundError(profileId, outputInvokerId);
    }

    const target = await dependencies.materializeOutput(
      Object.freeze({ profileId, output }),
      options
    );
    try {
      const invocation = await outputInvoker.capability.invoke(
        Object.freeze({ profileId, target, input: invocationInput }),
        options
      );
      return invocation.kind === OutputInvocationKind.Streaming
        ? Object.freeze({
            kind: OutputInvocationKind.Streaming,
            stream: wrapInvocationStream(invocation.stream, profileId, outputId),
          })
        : invocation;
    } catch (cause: unknown) {
      if (isAbortError(cause)) throw cause;
      throw new OutputInvocationCapabilityError(profileId, outputId, { cause });
    }
  };
}

function wrapInvocationStream(
  stream: AsyncIterable<JsonValue>,
  profileId: string,
  outputId: string
): AsyncIterable<JsonValue> {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      try {
        yield* stream;
      } catch (cause: unknown) {
        if (isAbortError(cause)) throw cause;
        throw new OutputInvocationCapabilityError(profileId, outputId, { cause });
      }
    },
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Output invocation was aborted before capability invocation.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
