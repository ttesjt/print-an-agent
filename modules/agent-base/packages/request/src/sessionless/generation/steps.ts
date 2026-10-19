import {
  requireCompletionCapability,
  requireStreamingCapability,
  type ModelGenerationEvent,
} from '@ta-agent/model-invocation-core';
import { composeExecutionSignal } from '@ta-agent/workflow-core';
import { resolveRequestInstructions } from '../../preparation/instructions.js';
import { requireValue } from '../../preparation/state-value.js';
import { deliverTextDelta, deliverReasoningDelta } from '../../delivery/steps.js';
import { openSessionlessOutput, completeSessionlessResponse } from '../output.js';
import { validateSessionlessRequest, prepareSessionlessContext } from '../context.js';
import type { SessionlessGenerationContext } from '../contracts.js';

export function buildGenerationContext(context: SessionlessGenerationContext): Promise<void> {
  context.state.modelRequest = Object.freeze({
    instructions: requireValue(context.state.instructions, 'instructions'),
    messages: prepareSessionlessContext(context),
    maxOutputCharacters: context.resources.policy.maxOutputCharacters,
    signal: context.signal,
  });
  return Promise.resolve();
}

export function resolveGenerationTarget(mode: 'direct' | 'stream') {
  return (context: SessionlessGenerationContext): Promise<void> => {
    context.state.actor =
      mode === 'direct'
        ? requireCompletionCapability(context.resources.actor)
        : requireStreamingCapability(context.resources.actor);
    return Promise.resolve();
  };
}

export async function invokeCompletion(context: SessionlessGenerationContext): Promise<void> {
  const interaction = requireValue(context.state.interaction, 'interaction');
  interaction.result = await requireCompletionCapability(
    requireValue(context.state.actor, 'actor')
  ).complete({
    ...requireValue(context.state.modelRequest, 'modelRequest'),
    signal: composeExecutionSignal([context.signal, interaction.signal]),
  });
}

export async function invokeGenerationStream(context: SessionlessGenerationContext): Promise<void> {
  const interaction = requireValue(context.state.interaction, 'interaction');
  interaction.result = await requireStreamingCapability(
    requireValue(context.state.actor, 'actor')
  ).stream({
    ...requireValue(context.state.modelRequest, 'modelRequest'),
    signal: composeExecutionSignal([context.signal, interaction.signal]),
    maxReasoningCharacters: context.resources.policy.maxReasoningCharacters,
    emit: (event: ModelGenerationEvent) => interaction.emit(event),
  });
}

export function buildGenerationResponse(context: SessionlessGenerationContext): Promise<void> {
  context.state.response = requireValue(
    requireValue(context.state.interaction, 'interaction').result,
    'result'
  );
  return Promise.resolve();
}

export const generationPreparationSteps = Object.freeze({
  validateRequest: validateSessionlessRequest,
  resolveInstructions: resolveRequestInstructions,
  buildModelContext: buildGenerationContext,
  openResponseStream: openSessionlessOutput,
  deliverTextDelta,
  deliverReasoningDelta,
  buildResponse: buildGenerationResponse,
  completeResponse: completeSessionlessResponse,
});
