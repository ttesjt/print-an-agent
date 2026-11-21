import { requireInteractionCapability } from '@print-an-agent/model-invocation-core';
import { AgentRequestError } from '../../errors.js';
import { invokeRequestInteraction } from '../../interaction/index.js';
import { buildInteractionRequest } from '../../preparation/index.js';
import { requireValue } from '../../state-access.js';
import { prepareSessionlessContext } from '../context.js';
import type { SessionlessInteractionContext } from './types/profile.js';

export function resolveInteractionTarget(context: SessionlessInteractionContext): Promise<void> {
  const actor = requireInteractionCapability(context.resources.actor);
  context.state.actor = actor;
  context.state.target = actor;
  context.state.toolPermissionPolicy = context.resources.toolPermissionPolicy;
  return Promise.resolve();
}

export function buildSessionlessInteractionContext(
  context: SessionlessInteractionContext
): Promise<void> {
  const messages = prepareSessionlessContext(context);
  const prompt = messages.at(-1);
  if (prompt?.role !== 'user')
    throw new AgentRequestError(
      'REQUEST_CONTEXT_INCOMPLETE',
      'Interaction requires its current user message.'
    );
  context.state.history = Object.freeze(messages.slice(0, -1));
  context.state.userMessage = prompt;
  return buildInteractionRequest(context);
}

export function invokeSessionlessInteraction(
  context: SessionlessInteractionContext
): Promise<void> {
  return invokeRequestInteraction(context, requireValue(context.state.target, 'target'));
}

export function closeSessionlessTools(context: SessionlessInteractionContext): void {
  if (context.state.toolsClosed) return;
  context.state.toolsClosed = true;
  context.state.tools?.close();
}

export function buildInteractionResponse(context: SessionlessInteractionContext): Promise<void> {
  const result = requireValue(
    requireValue(context.state.interaction, 'interaction').result,
    'result'
  );
  closeSessionlessTools(context);
  context.state.response = Object.freeze({
    message: result.message,
    toolRun: requireValue(context.state.tools, 'tools').inspect(),
  });
  return Promise.resolve();
}
