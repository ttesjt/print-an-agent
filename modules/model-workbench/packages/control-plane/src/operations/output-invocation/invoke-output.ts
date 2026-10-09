import { parseJsonValue } from '@ta-agent/workbench-domain';
import { OutputInvocationKind } from '@ta-agent/workbench-extension';

import type { InvokeOutputInput, OutputInvocation } from './contracts.js';
import { OutputInvocationCapabilityError } from './errors.js';
import type { MaterializeOutput } from './materialize-output.js';
import type { OutputInvocationTargetResolver } from './resolve-output-invocation-target.js';
import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';
import { wrapInvocationStream } from './wrap-invocation-stream.js';

export interface InvokeOutputDependencies {
  readonly targetResolver: OutputInvocationTargetResolver;
  readonly materializeOutput: MaterializeOutput;
}

export function createInvokeOutput(dependencies: InvokeOutputDependencies) {
  return async function invokeOutput(
    input: InvokeOutputInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<OutputInvocation> {
    assertNotAborted(options?.signal);
    const invocationInput = parseJsonValue(input.input, 'outputInvocation.input');
    const resolvedTarget = await dependencies.targetResolver.resolve(
      Object.freeze({
        profileId: input.profileId,
        outputId: input.outputId,
        ...(input.outputInvokerId === undefined ? {} : { outputInvokerId: input.outputInvokerId }),
      }),
      options
    );

    const target = await dependencies.materializeOutput(
      Object.freeze({
        profileId: resolvedTarget.evidence.profileId,
        output: resolvedTarget.output,
      }),
      options
    );
    try {
      const invocation = await resolvedTarget.outputInvoker.capability.invoke(
        Object.freeze({
          profileId: resolvedTarget.evidence.profileId,
          target,
          input: invocationInput,
        }),
        options
      );
      return invocation.kind === OutputInvocationKind.Streaming
        ? Object.freeze({
            kind: OutputInvocationKind.Streaming,
            evidence: resolvedTarget.evidence,
            stream: wrapInvocationStream(
              invocation.stream,
              resolvedTarget.evidence.profileId,
              resolvedTarget.evidence.outputId
            ),
          })
        : Object.freeze({
            kind: OutputInvocationKind.Completed,
            evidence: resolvedTarget.evidence,
            result: invocation.result,
          });
    } catch (cause: unknown) {
      if (isAbortError(cause)) throw cause;
      throw new OutputInvocationCapabilityError(
        resolvedTarget.evidence.profileId,
        resolvedTarget.evidence.outputId,
        { cause }
      );
    }
  };
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
