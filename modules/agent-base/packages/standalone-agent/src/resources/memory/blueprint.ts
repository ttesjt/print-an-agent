import { compileResourceBlueprint } from '@print-an-agent/base-composition/resource-registry';
import type { CreateStandaloneMemoryProfileOptions } from '../../types.js';
import { memoryAuthorityProvider } from './authority-provider.js';
import { memoryPersistenceProvider } from './persistence-provider.js';

/** The only Memory Profile resource recipe. Compilation acquires nothing. */
export function memoryResourceBlueprint(
  options: Pick<
    CreateStandaloneMemoryProfileOptions,
    'clock' | 'acquireAuthority' | 'acquireSessionPersistence'
  >
) {
  const authority = memoryAuthorityProvider(options);
  const persistence = memoryPersistenceProvider(options);
  return Object.freeze({
    blueprint: compileResourceBlueprint([authority.provider, persistence.provider]),
    authority: authority.token,
    persistence: persistence.token,
  });
}
