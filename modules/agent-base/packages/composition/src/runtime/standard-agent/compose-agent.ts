import { createAgent } from '@print-an-agent/base-runtime';
import { createStandardAgentDefinition } from './create-definition.js';
import type { ComposeAgentOptions } from './types/options.js';

export function composeAgent(options: ComposeAgentOptions) {
  return createAgent(createStandardAgentDefinition(options));
}

export type ComposedAgent = ReturnType<typeof composeAgent>;
