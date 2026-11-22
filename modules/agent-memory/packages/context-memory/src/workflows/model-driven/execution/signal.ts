import { composeExecutionSignal } from '@print-an-agent/workflow-core';
import type { ModelMemoryState, ModelMemoryContext } from '../types/workflow.js';

const signals = new WeakMap<ModelMemoryState, AbortSignal>();

export function bindModelMemorySignal(context: ModelMemoryContext, signal: AbortSignal): void {
  signals.set(context.state, signal);
}

/** Also preserves a child Core scope's cancellation; custom Steps use this for borrowed calls. */
export function modelMemorySignal(context: ModelMemoryContext): AbortSignal {
  const signal = signals.get(context.state);
  return signal === undefined ? context.signal : composeExecutionSignal([context.signal, signal]);
}
