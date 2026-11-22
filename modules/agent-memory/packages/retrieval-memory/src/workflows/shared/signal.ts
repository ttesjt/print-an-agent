import { composeExecutionSignal } from '@print-an-agent/workflow-core';

/** Preserve both the operation deadline and the active native Step/parallel scope. */
export function effectiveRetrievalSignal(context: {
  readonly signal: AbortSignal;
  readonly state: { readonly signal?: AbortSignal };
}): AbortSignal {
  return context.state.signal === undefined
    ? context.signal
    : composeExecutionSignal([context.signal, context.state.signal]);
}
