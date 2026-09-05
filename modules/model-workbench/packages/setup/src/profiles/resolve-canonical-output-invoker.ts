import type { OutputInvokerId } from '@ta-agent/workbench-domain';

import { invalidSetup } from '../foundation/parsing.js';
import type { ResolvedOutputInvokerSlot } from './contracts.js';

export function resolveCanonicalOutputInvoker(
  outputInvokers: readonly ResolvedOutputInvokerSlot[],
  configuredOutputInvokerId: OutputInvokerId | undefined,
  path: string
): ResolvedOutputInvokerSlot | undefined {
  if (configuredOutputInvokerId !== undefined) {
    const configured = outputInvokers.find(
      ({ outputInvokerId }) => outputInvokerId === configuredOutputInvokerId
    );
    if (configured === undefined) {
      invalidSetup(path, `references unknown Output Invoker "${configuredOutputInvokerId}"`);
    }
    return configured;
  }

  return outputInvokers.length === 1 ? outputInvokers[0] : undefined;
}
