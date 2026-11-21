import type { ResourceBlueprint } from '@print-an-agent/base-composition/resource-registry';
import { compileResourceBlueprint } from '@print-an-agent/base-composition/resource-registry';
import type { MemoryProvisioningOptions } from '../types/provisioning.js';
import { memoryAuthorityProvider } from './authority-provider.js';
import { memoryPersistenceProvider } from './persistence-provider.js';

/** The only Memory Profile resource recipe. Compilation acquires nothing. */
export function memoryResourceBlueprint(
  options: Pick<
    MemoryProvisioningOptions,
    'clock' | 'acquireAuthority' | 'acquireSessionPersistence'
  >
): Readonly<{
  blueprint: ResourceBlueprint;
  authority: ReturnType<typeof memoryAuthorityProvider>['token'];
  persistence: ReturnType<typeof memoryPersistenceProvider>['token'];
}> {
  const authority = memoryAuthorityProvider(options);
  const persistence = memoryPersistenceProvider(options);
  return Object.freeze({
    blueprint: compileResourceBlueprint([authority.provider, persistence.provider]),
    authority: authority.token,
    persistence: persistence.token,
  });
}
