import {
  createContextMemoryManagementService,
  createRetrievalMemoryManagementService,
  type ContextMemoryManagementCapability,
  type RetrievalMemoryManagementCapability,
  type ManagedAgentNamespacePort,
} from '@print-an-agent/base-composition';
import {
  memoryCapabilities,
  type ContextMemoryPort,
  type RetrievalMemoryPort,
  type WebMemoryPorts,
} from '../../memory/contracts.js';
import { contextCodecs as c } from '../../memory/schemas/context.js';
import { retrievalCodecs as r } from '../../memory/schemas/retrieval.js';
import type { WebMemoryOptions } from './options.js';
import {
  projectMemoryMutation,
  projectMemoryRead,
  projectMemoryReceipt,
  unwrapRetrieval,
} from './projection.js';

type Definition<N> = {
  readonly namespace: { readonly port: ManagedAgentNamespacePort<N> };
} & Partial<ContextMemoryManagementCapability<N> & RetrievalMemoryManagementCapability<N>>;
export function createWebMemoryPorts<N>(
  definition: Definition<N>,
  options?: WebMemoryOptions
): WebMemoryPorts | undefined {
  const contextService =
    definition.contextMemoryManagement === undefined
      ? undefined
      : createContextMemoryManagementService(definition);
  const retrievalService =
    definition.retrievalMemoryManagement === undefined
      ? undefined
      : createRetrievalMemoryManagementService(definition);
  if (contextService === undefined && retrievalService === undefined) return undefined;
  const capabilities = memoryCapabilities.decode({
    ...(contextService === undefined
      ? {}
      : {
          context: {
            bindings: options?.contextBindings ?? [{ memoryId: 'main', label: 'Context memory' }],
          },
        }),
    ...(retrievalService === undefined
      ? {}
      : {
          retrieval: {
            bindings: options?.retrievalBindings ?? [
              { memoryId: 'main', label: 'Retrieval memory' },
            ],
            embeddings: options?.embeddings ?? [],
          },
        }),
  });
  const context: ContextMemoryPort | undefined =
    contextService === undefined
      ? undefined
      : {
          inspect: ({ signal, ...i }) =>
            projectMemoryRead(c.inspect.output, () =>
              contextService.inspect(i, signal === undefined ? undefined : { signal })
            ),
          getReceipt: ({ signal, ...i }) =>
            projectMemoryReceipt('context', c.getReceipt.output, () =>
              contextService.getReceipt(i, signal === undefined ? undefined : { signal })
            ),
          readContext: ({ signal, ...i }) =>
            projectMemoryRead(c.readContext.output, () =>
              contextService.readContext(i, signal === undefined ? undefined : { signal })
            ),
          create: ({ signal, ...i }) =>
            projectMemoryMutation('context', i, c.create.output, () =>
              contextService.create(i, signal === undefined ? undefined : { signal })
            ),
          apply: ({ signal, ...i }) =>
            projectMemoryMutation('context', i, c.apply.output, () =>
              contextService.apply(i, signal === undefined ? undefined : { signal })
            ),
          configure: ({ signal, ...i }) =>
            projectMemoryMutation('context', i, c.configure.output, () =>
              contextService.configure(i, signal === undefined ? undefined : { signal })
            ),
        };
  const retrieval: RetrievalMemoryPort | undefined =
    retrievalService === undefined
      ? undefined
      : {
          inspect: ({ signal, ...i }) =>
            projectMemoryRead(
              r.inspect.output,
              () => retrievalService.inspect(i, signal === undefined ? undefined : { signal }),
              unwrapRetrieval
            ),
          get: ({ signal, ...i }) =>
            projectMemoryRead(
              r.get.output,
              () => retrievalService.get(i, signal === undefined ? undefined : { signal }),
              unwrapRetrieval
            ),
          getReceipt: ({ signal, ...i }) =>
            projectMemoryReceipt(
              'retrieval',
              r.getReceipt.output,
              () => retrievalService.getReceipt(i, signal === undefined ? undefined : { signal }),
              unwrapRetrieval
            ),
          list: ({ signal, ...i }) =>
            projectMemoryRead(
              r.list.output,
              () => retrievalService.list(i, signal === undefined ? undefined : { signal }),
              unwrapRetrieval
            ),
          search: ({ signal, ...i }) =>
            projectMemoryRead(
              r.search.output,
              () => retrievalService.search(i, signal === undefined ? undefined : { signal }),
              unwrapRetrieval
            ),
          readContext: ({ signal, ...i }) =>
            projectMemoryRead(
              r.readContext.output,
              () => retrievalService.readContext(i, signal === undefined ? undefined : { signal }),
              unwrapRetrieval
            ),
          create: ({ signal, ...i }) =>
            projectMemoryMutation('retrieval', i, r.create.output, () =>
              retrievalService.create(i, signal === undefined ? undefined : { signal })
            ),
          ingest: ({ signal, ...i }) =>
            projectMemoryMutation('retrieval', i, r.ingest.output, () =>
              retrievalService.ingest(i, signal === undefined ? undefined : { signal })
            ),
          update: ({ signal, ...i }) =>
            projectMemoryMutation('retrieval', i, r.update.output, () =>
              retrievalService.update(i, signal === undefined ? undefined : { signal })
            ),
          remove: ({ signal, ...i }) =>
            projectMemoryMutation('retrieval', i, r.remove.output, () =>
              retrievalService.remove(i, signal === undefined ? undefined : { signal })
            ),
          reindex: ({ signal, ...i }) =>
            projectMemoryMutation('retrieval', i, r.reindex.output, () =>
              retrievalService.reindex(i, signal === undefined ? undefined : { signal })
            ),
        };
  return Object.freeze({
    capabilities,
    ...(context === undefined ? {} : { context }),
    ...(retrieval === undefined ? {} : { retrieval }),
  });
}
