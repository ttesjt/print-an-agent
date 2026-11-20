import type { ManagedAgentNamespace } from '../../namespace/index.js';

export interface MemoryManagementOptions {
  readonly signal?: AbortSignal;
}
export interface MemoryInvocation<T> {
  readonly memoryId: string;
  invoke(signal?: AbortSignal): Promise<T>;
}
export interface MemoryProvisioningRequest<N, I> {
  readonly namespace: ManagedAgentNamespace<N>;
  readonly input: I;
}

/** Named typed factories, not a string/unknown service locator. Acquisition does not transfer ownership. */
export type MemoryOperationProvisioning<N, I, O extends { [K in keyof I]: unknown }> = {
  readonly [K in keyof I]: (
    request: MemoryProvisioningRequest<N, I[K]>,
    options?: MemoryManagementOptions
  ) => MemoryInvocation<O[K]> | Promise<MemoryInvocation<O[K]>>;
};
