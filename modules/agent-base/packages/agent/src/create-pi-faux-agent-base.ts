import { createPiFauxRuntime } from '@ta-agent/base-pi';
import { assembleAgentBase } from './assemble-agent-base.js';
import type { CreatePiFauxAgentBaseOptions, PiFauxAgentBase } from './types.js';

export function createPiFauxAgentBase(options: CreatePiFauxAgentBaseOptions): PiFauxAgentBase {
  const { pi, ...baseOptions } = options;
  const piProfile = createPiFauxRuntime(pi);
  const assembled = assembleAgentBase({
    ...baseOptions,
    modelRuntime: piProfile.runtime,
    modelReference: piProfile.modelReference,
  });
  return Object.freeze({ ...assembled, inspectPi: () => piProfile.inspect() });
}
