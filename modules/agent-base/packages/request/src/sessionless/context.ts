import { validateRequestMessage } from '../preparation/message.js';
import { requireValue } from '../preparation/state-value.js';
import { validateSessionlessOutputSink } from './output.js';
import { closedRecord, prepareSessionlessMessages } from './validation.js';
import type { SessionlessGenerationContext, SessionlessGenerationState } from './contracts.js';

type InputContext = Pick<SessionlessGenerationContext, 'resources' | 'signal' | 'workflowRunId'> & {
  readonly state: Pick<SessionlessGenerationState, 'input' | 'request'>;
};

export async function validateSessionlessRequest(context: InputContext): Promise<void> {
  const input = closedRecord(context.state.input, ['message', 'history'], 'REQUEST_INPUT_INVALID');
  const message = validateRequestMessage(
    input.message,
    context.resources.policy.maxMessageCharacters
  );
  const history = prepareSessionlessMessages(
    input.history === undefined ? [] : input.history,
    context.resources.policy.maxContextCharacters,
    context.resources.policy.maxContextMessages
  );
  const request = Object.freeze({ message, history });
  const outputSink =
    context.resources.createOutputSink === undefined
      ? undefined
      : validateSessionlessOutputSink(
          await context.resources.createOutputSink({
            request,
            workflowRunId: context.workflowRunId,
            signal: context.signal,
          })
        );
  context.state.request = Object.freeze({
    ...request,
    ...(outputSink === undefined ? {} : { outputSink }),
  });
}

export function prepareSessionlessContext(context: {
  readonly resources: Pick<SessionlessGenerationContext['resources'], 'clock' | 'policy'>;
  readonly state: Pick<SessionlessGenerationState, 'request' | 'externalContext'>;
}) {
  const request = requireValue(context.state.request, 'request');
  return prepareSessionlessMessages(
    [
      ...request.history,
      ...(context.state.externalContext ?? []),
      { role: 'user', text: request.message, timestamp: context.resources.clock() },
    ],
    context.resources.policy.maxContextCharacters,
    context.resources.policy.maxContextMessages
  );
}
