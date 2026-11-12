import type {
  ResourceRegistry,
  ResourceRequest,
  ResourceCallOptions,
} from '@print-an-agent/base-composition/resource-registry';
import { ResourceCleanupError } from '@print-an-agent/base-composition/resource-registry';
import { ContextMemoryError } from '@print-an-agent/context-memory';
import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';

/** Translate lifecycle failure at the concrete composition boundary, never in generic Services. */
export async function resolveMemoryResource<B, V>(
  domain: 'context' | 'retrieval',
  registry: ResourceRegistry,
  request: ResourceRequest<B, V>,
  options?: ResourceCallOptions
): Promise<V> {
  try {
    return await registry.resolve(request, options);
  } catch (cause) {
    if (!(cause instanceof ResourceCleanupError)) throw cause;
    if (domain === 'context')
      throw new ContextMemoryError(
        'CLEANUP_FAILED',
        'Memory resource cleanup could not be confirmed.',
        { cause, commit: { status: 'not-committed' } }
      );
    throw new RetrievalMemoryError(
      'CLEANUP_FAILED',
      'Memory resource cleanup could not be confirmed.',
      { cause, commit: { status: 'not-committed' } }
    );
  }
}
