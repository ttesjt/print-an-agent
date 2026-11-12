import { array, object, optional, type Decoder } from '@print-an-agent/ui-transport';
import { content, id } from './schemas/common.js';
import { indexFields } from './schemas/retrieval.js';
import type { contextCodecs } from './schemas/context.js';
import type { retrievalCodecs } from './schemas/retrieval.js';

/** UI-owned feature contracts. No imports of Agent Base, domain adapters or Registry. */
type Codecs = Readonly<
  Record<string, { readonly input: Decoder<unknown>; readonly output: Decoder<unknown> }>
>;
export type MemoryFeaturePort<C extends Codecs> = {
  readonly [K in keyof C]: (
    input: ReturnType<C[K]['input']['decode']> & { readonly signal?: AbortSignal }
  ) => Promise<ReturnType<C[K]['output']['decode']>>;
};
export type ContextMemoryPort = MemoryFeaturePort<typeof contextCodecs>;
export type RetrievalMemoryPort = MemoryFeaturePort<typeof retrievalCodecs>;
const binding = object({ memoryId: id, label: content });
const embedding = object({ ...indexFields, label: content });
export const memoryCapabilities = object({
  context: optional(object({ bindings: array(binding) })),
  retrieval: optional(object({ bindings: array(binding), embeddings: array(embedding) })),
});
export type MemoryCapabilities = ReturnType<typeof memoryCapabilities.decode>;
export interface WebMemoryPorts {
  readonly capabilities: MemoryCapabilities;
  readonly context?: ContextMemoryPort;
  readonly retrieval?: RetrievalMemoryPort;
}
