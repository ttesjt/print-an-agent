import type { InteractionTools } from '../model/tools.js';

/** Add invocation cancellation without taking ownership of the borrowed tools. */
export function bindInteractionTools(
  runtime: InteractionTools,
  signal: AbortSignal
): InteractionTools {
  return Object.freeze({
    tools: runtime.tools,
    execute: (proposal, options) =>
      runtime.execute(proposal, {
        signal: options?.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
      }),
  } satisfies InteractionTools);
}
