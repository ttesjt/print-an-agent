import {
  AgentSessionError,
  defineSessionTurnPresentation,
  MAX_SESSION_PRESENTATION_BLOCKS,
  MAX_SESSION_PRESENTATION_CHARACTERS,
  supportsSessionPresentation,
} from '@print-an-agent/base-session';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { requireInteractionEvent } from '../../interaction/index.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export function captureReasoningPresentation(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  if (!supportsSessionPresentation(context.resources.session)) {
    throw new AgentSessionError(
      'SESSION_PRESENTATION_NOT_CONFIGURED',
      'Reasoning capture requires atomic Session presentation support.'
    );
  }
  const { delta } = requireInteractionEvent(context, 'reasoning-delta');
  if (delta.length === 0) return Promise.resolve();
  const captured = context.state.capturedReasoning ?? { blocks: [], characterCount: 0 };
  assertPresentationSize(context, captured.characterCount + delta.length);
  // Single-turn Engines may omit lifecycle events; do not invent additional boundaries.
  const modelTurnIndex = Math.max(context.state.modelTurnCount ?? 0, 1);
  let block = captured.blocks.at(-1);
  if (block?.modelTurnIndex !== modelTurnIndex) {
    if (captured.blocks.length >= MAX_SESSION_PRESENTATION_BLOCKS) {
      throw new AgentSessionError(
        'SESSION_PRESENTATION_LIMIT_EXCEEDED',
        'Reasoning presentation exceeded its block bound.'
      );
    }
    block = { modelTurnIndex, chunks: [] };
    captured.blocks.push(block);
  }
  block.chunks.push(delta);
  captured.characterCount += delta.length;
  context.state.capturedReasoning = captured;
  return Promise.resolve();
}

export function buildTurnPresentation(context: DefaultRequestWorkflowContext): Promise<void> {
  delete context.state.turnPresentation;
  const captured = context.state.capturedReasoning;
  if (captured !== undefined && captured.blocks.length > 0) {
    const presentation = defineSessionTurnPresentation({
      reasoningBlocks: captured.blocks.map(({ modelTurnIndex, chunks }) => ({
        modelTurnIndex,
        text: chunks.join(''),
      })),
    });
    assertPresentationSize(
      context,
      presentation.reasoningBlocks.reduce((sum, block) => sum + block.text.length, 0)
    );
    context.state.turnPresentation = presentation;
  }
  return Promise.resolve();
}

function assertPresentationSize(context: DefaultRequestWorkflowContext, characters: number): void {
  if (characters > context.resources.policy.maxReasoningCharacters) {
    throw new ModelInvocationError(
      'MODEL_REASONING_LIMIT_EXCEEDED',
      'Reasoning presentation exceeded the request character budget.'
    );
  }
  if (characters > MAX_SESSION_PRESENTATION_CHARACTERS) {
    throw new AgentSessionError(
      'SESSION_PRESENTATION_LIMIT_EXCEEDED',
      'Reasoning presentation exceeded its storage character bound.'
    );
  }
}
