import {
  defineResourceProvider,
  ResourceToken,
} from '@print-an-agent/base-composition/resource-registry';
import {
  createMemorySessionPersistence,
  type CoordinatedSessionPersistence,
} from '@print-an-agent/base-local-adapters';
import type { CreateStandaloneMemoryProfileOptions } from '../../types.js';
import { parseAllocationBinding, describeAllocation } from './allocation-binding.js';

function isPersistence(value: unknown): value is CoordinatedSessionPersistence {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('session' in value) ||
    !('requestJournal' in value) ||
    !('maintenance' in value)
  )
    return false;
  return (
    typeof value.session === 'object' &&
    value.session !== null &&
    'resolve' in value.session &&
    typeof value.session.resolve === 'function' &&
    typeof value.requestJournal === 'object' &&
    value.requestJournal !== null &&
    'claim' in value.requestJournal &&
    typeof value.requestJournal.claim === 'function' &&
    typeof value.maintenance === 'object' &&
    value.maintenance !== null &&
    'purgeSessionPersistence' in value.maintenance &&
    typeof value.maintenance.purgeSessionPersistence === 'function'
  );
}

export function memoryPersistenceProvider(
  options: Pick<CreateStandaloneMemoryProfileOptions, 'clock' | 'acquireSessionPersistence'>
) {
  const token = new ResourceToken('standalone.coordinated-session-persistence', {
    parseBinding: parseAllocationBinding,
    isValue: isPersistence,
  });
  const clock = options.clock;
  const acquire = options.acquireSessionPersistence;
  const provider = defineResourceProvider({
    token,
    dependencies: {},
    describe: describeAllocation,
    create: ({ binding, signal }) =>
      acquire === undefined
        ? { value: createMemorySessionPersistence(clock === undefined ? {} : { clock }) }
        : acquire({ ...binding, signal }),
  });
  return { provider, token };
}
