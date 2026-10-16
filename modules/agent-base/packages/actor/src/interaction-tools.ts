import type { ToolRuntime } from '@ta-agent/base-tool';

/** Borrow the existing runtime; keep ownership and budgets with the Request. */
export function bindInteractionTools(runtime: ToolRuntime, signal: AbortSignal): ToolRuntime {
  return Object.freeze({
    tools: runtime.tools,
    execute: (proposal, options) =>
      runtime.execute(proposal, {
        signal: options?.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
      }),
    inspect: () => runtime.inspect(),
    close: () => runtime.close(),
  } satisfies ToolRuntime);
}
