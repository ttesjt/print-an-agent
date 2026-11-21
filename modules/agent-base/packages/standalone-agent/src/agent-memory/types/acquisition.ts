import type { ResourceAcquisition } from '@print-an-agent/base-composition/resource-registry';
import type { TextTokenInput, TokenCounter } from '@print-an-agent/model-invocation-core';

export type MemoryTextCounter = TokenCounter<TextTokenInput>;

export type MemoryCapabilityAcquirer<T> = (
  ref: string,
  signal: AbortSignal
) => ResourceAcquisition<T> | Promise<ResourceAcquisition<T>>;

export interface MemoryStorageAcquisition {
  readonly agentId: string;
  readonly path: string;
  readonly signal: AbortSignal;
}
