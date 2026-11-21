import type { PiToolAdapterState } from './types.js';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type {
  ToolExecutionOutcome,
  InteractionTools,
  ToolDescriptor,
} from '@print-an-agent/model-invocation-core';

import { toPiToolSchema } from '../../translation/index.js';

function toPiToolFailure(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Tool runtime rejected with a non-Error.');
}

function createPiTool(
  descriptor: ToolDescriptor,
  runtime: InteractionTools,
  state: PiToolAdapterState
): AgentTool {
  return {
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.description,
    parameters: toPiToolSchema(descriptor.parameters),
    executionMode: 'sequential',
    async execute(toolCallId, arguments_, signal) {
      // Pi recovers from tool errors within a batch; a rejected port must stop further side effects.
      if (state.terminalFailure !== undefined) {
        throw toPiToolFailure(state.terminalFailure.cause);
      }
      state.attemptedCallIds.add(toolCallId);
      let outcome: ToolExecutionOutcome;
      try {
        outcome = await runtime.execute(
          { callId: toolCallId, toolName: descriptor.name, arguments: arguments_ },
          signal === undefined ? undefined : { signal }
        );
      } catch (cause: unknown) {
        state.terminalFailure ??= { cause };
        throw toPiToolFailure(cause);
      }
      // A declared handler error is model-visible; a rejected execution port is authoritative.
      if (outcome.status === 'handler-error') throw new Error(outcome.text);
      return { content: [{ type: 'text', text: outcome.text }], details: Object.freeze({}) };
    },
  };
}

export function createPiTools(runtime: InteractionTools, state: PiToolAdapterState): AgentTool[] {
  return runtime.tools.map((descriptor) => createPiTool(descriptor, runtime, state));
}
