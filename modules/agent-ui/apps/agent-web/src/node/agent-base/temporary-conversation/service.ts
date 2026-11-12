import {
  createSessionlessRequestService,
  type AgentManagementService,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity';
import { ActorError, ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { AgentRequestError } from '@print-an-agent/base-request';
import { runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import type { AgentWebConfig } from '../../../application/agent-config.js';
import {
  TEMPORARY_EVENT,
  type TemporaryConversationPort,
  type TemporaryFailure,
} from '../../../temporary-conversation/contracts.js';
import { parseTemporaryRequest } from '../../../temporary-conversation/validation.js';
import { createTemporaryOutput } from './output.js';
import {
  resolveTemporaryResources,
  temporaryModelHistory,
  type TemporaryResourceTarget,
} from './resources.js';
import { type WebModelHost, WebModelError } from '../model-runtime.js';

class TemporaryAdmissionError extends Error {
  constructor(readonly code: string) {
    super('Temporary conversation cannot use the selected configuration.');
  }
}
function failure(error: unknown): TemporaryFailure {
  const code =
    error instanceof ActorError ||
    error instanceof ModelInvocationError ||
    error instanceof AgentRequestError ||
    error instanceof TemporaryAdmissionError ||
    error instanceof WebModelError
      ? error.code
      : 'TEMPORARY_REQUEST_FAILED';
  return Object.freeze({ code, message: 'The temporary response could not be completed.' });
}

/** Narrow dependencies intentionally exclude Agent materialization, Sessions and Journals. */
export function createWebTemporaryConversationPort(dependencies: {
  readonly agents: Pick<AgentManagementService<AgentWebConfig>, 'inspect'>;
  readonly modelHost: WebModelHost;
}): TemporaryConversationPort {
  const service = createSessionlessRequestService<TemporaryResourceTarget>({
    workflow: { mode: 'stream', name: 'web.temporary-response' },
    resolveResources: ({ target, signal }) =>
      resolveTemporaryResources(target, signal, dependencies.modelHost),
  });
  return {
    async streamTemporaryConversation(request, consume) {
      const { signal: parentSignal, ...payload } = request;
      const input = parseTemporaryRequest(payload);
      const signal = parentSignal ?? new AbortController().signal;
      signal.throwIfAborted();
      await consume({ type: TEMPORARY_EVENT.OPENED, interactionId: input.interactionId });
      let terminal = false;
      try {
        const snapshot = await dependencies.agents.inspect(parseAgentId(input.agentId), { signal });
        signal.throwIfAborted();
        if (snapshot.identity.status !== 'active')
          throw new TemporaryAdmissionError('TEMPORARY_TARGET_DISABLED');
        if (String(snapshot.config.revision) !== input.expectedConfigRevision)
          throw new TemporaryAdmissionError('TEMPORARY_CONFIG_CONFLICT');
        const output = createTemporaryOutput(input.interactionId, consume);
        const result = await runWithExecutionTimeout(
          {
            parentSignal: signal,
            timeoutMilliseconds: snapshot.config.value.execution.requestTimeoutMilliseconds,
            createTimeoutFailure: () =>
              new AgentRequestError(
                'REQUEST_TIMEOUT',
                'Temporary request exceeded its execution deadline.'
              ),
          },
          async (effectiveSignal) => {
            const workflow = await service.open(
              { snapshot, sink: output.sink },
              { signal: effectiveSignal }
            );
            const response = await workflow.run({
              input: { message: input.message, history: temporaryModelHistory(input.history) },
              signal: effectiveSignal,
            });
            if (response === undefined)
              throw new AgentRequestError(
                'REQUEST_OUTPUT_STATE_INVALID',
                'Temporary response was skipped.'
              );
            return output.complete(response);
          }
        );
        signal.throwIfAborted();
        terminal = true;
        await consume({
          type: TEMPORARY_EVENT.COMPLETED,
          interactionId: input.interactionId,
          assistant: result,
          configRevision: String(snapshot.config.revision),
        });
      } catch (cause: unknown) {
        if (terminal) throw cause;
        terminal = true;
        await consume(
          signal.aborted
            ? { type: TEMPORARY_EVENT.CANCELLED, interactionId: input.interactionId }
            : {
                type: TEMPORARY_EVENT.FAILED,
                interactionId: input.interactionId,
                failure: failure(cause),
              }
        );
      }
    },
  };
}
