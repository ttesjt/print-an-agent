import type { SessionMemoryNavigationPort } from './types/navigation.js';
import type { SessionMemoryPort } from './types/records.js';

export function supportsSessionMemory(value: object): value is SessionMemoryPort {
  return (
    'readMemoryRecord' in value &&
    typeof value.readMemoryRecord === 'function' &&
    'writeMemoryRecord' in value &&
    typeof value.writeMemoryRecord === 'function' &&
    'listPendingMemoryRecords' in value &&
    typeof value.listPendingMemoryRecords === 'function'
  );
}

export function supportsSessionMemoryNavigation(
  value: object
): value is SessionMemoryNavigationPort {
  return (
    supportsSessionMemory(value) &&
    'publishMemoryNavigation' in value &&
    typeof value.publishMemoryNavigation === 'function'
  );
}
