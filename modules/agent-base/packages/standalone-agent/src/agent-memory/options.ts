import { validateMemoryIdentifier } from '@print-an-agent/base-composition';
import type { StandaloneMemoryManagementOptions } from './types/options.js';

export function snapshotMemoryManagementOptions(
  input: StandaloneMemoryManagementOptions
): StandaloneMemoryManagementOptions {
  validateMemoryIdentifier(input.storageNamespaceId);
  return Object.freeze({
    ...input,
    ...(input.context === undefined
      ? {}
      : {
          context: Object.freeze({
            ...input.context,
            ...(input.context.runtime === undefined
              ? {}
              : {
                  runtime: Object.freeze({
                    ...input.context.runtime,
                    ...(input.context.runtime.toolAllowList === undefined
                      ? {}
                      : { toolAllowList: Object.freeze([...input.context.runtime.toolAllowList]) }),
                    ...(input.context.runtime.workflows === undefined
                      ? {}
                      : { workflows: Object.freeze({ ...input.context.runtime.workflows }) }),
                  }),
                }),
            ...(input.context.workflows === undefined
              ? {}
              : { workflows: Object.freeze({ ...input.context.workflows }) }),
            ...(input.context.defaults === undefined
              ? {}
              : { defaults: structuredClone(input.context.defaults) }),
          }),
        }),
    ...(input.retrieval === undefined
      ? {}
      : {
          retrieval: Object.freeze({
            ...input.retrieval,
            ...(input.retrieval.workflows === undefined
              ? {}
              : { workflows: Object.freeze({ ...input.retrieval.workflows }) }),
            ...(input.retrieval.policy === undefined
              ? {}
              : { policy: Object.freeze({ ...input.retrieval.policy }) }),
          }),
        }),
  });
}
