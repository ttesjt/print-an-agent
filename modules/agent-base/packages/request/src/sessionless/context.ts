import { defineModelMessage, type ModelMessage } from '@print-an-agent/model-invocation-core';
import { AgentRequestError } from '../errors.js';
import { validateRequestMessage } from '../preparation/index.js';
import { requireValue } from '../state-access.js';
import type { BoundSessionlessResources } from './types/resources.js';
import type { SessionlessState } from './types/state.js';

import { closedRecord } from './configuration.js';
import { validateSessionlessOutputSink } from './output.js';

type InputContext = {
  readonly resources: BoundSessionlessResources;
  readonly signal: AbortSignal;
  readonly workflowRunId: string;
  readonly state: Pick<SessionlessState, 'input' | 'request'>;
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
  readonly resources: Pick<BoundSessionlessResources, 'clock' | 'policy'>;
  readonly state: Pick<SessionlessState, 'request' | 'externalContext'>;
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

/** Core owns each message protocol. This boundary owns collection size and text budgets only. */
function prepareSessionlessMessages(
  history: unknown,
  maxCharacters: number,
  maxMessages: number
): readonly ModelMessage[] {
  if (!Array.isArray(history))
    throw new AgentRequestError('REQUEST_INPUT_INVALID', 'Request history must be an array.');
  const messages: ModelMessage[] = [];
  let characters = 0;
  // Collection metadata also consumes the budget, including arrays of empty messages.
  if (history.length > maxMessages)
    throw new AgentRequestError(
      'REQUEST_INPUT_INVALID',
      'Request context exceeds its collection budget.'
    );
  for (let index = 0; index < history.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(history, index);
    if (descriptor === undefined || !('value' in descriptor))
      throw new AgentRequestError(
        'REQUEST_INPUT_INVALID',
        'Request history must contain data entries.'
      );
    const message = defineModelMessage(descriptor.value);
    characters += message.text.length;
    if (characters > maxCharacters)
      throw new AgentRequestError(
        'REQUEST_INPUT_INVALID',
        'Request context exceeds its character budget.'
      );
    messages.push(message);
  }
  return Object.freeze(messages);
}
