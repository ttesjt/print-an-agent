import type { ManagedAgentAuthorityPorts } from '@print-an-agent/base-composition';
import {
  MemoryAgentConfigAdapter,
  MemoryAgentIdentityCatalogAdapter,
} from '@print-an-agent/base-local-adapters';
import {
  defineResourceProvider,
  ResourceToken,
} from '@print-an-agent/base-composition/resource-registry';
import type { CreateStandaloneMemoryProfileOptions } from '../../types.js';
import { parseAllocationBinding, describeAllocation } from './allocation-binding.js';

function isAuthority(value: unknown): value is ManagedAgentAuthorityPorts {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('identityCatalog' in value) ||
    !('config' in value)
  )
    return false;
  const { identityCatalog, config } = value;
  return (
    typeof identityCatalog === 'object' &&
    identityCatalog !== null &&
    'read' in identityCatalog &&
    typeof identityCatalog.read === 'function' &&
    'list' in identityCatalog &&
    typeof identityCatalog.list === 'function' &&
    'create' in identityCatalog &&
    typeof identityCatalog.create === 'function' &&
    'transition' in identityCatalog &&
    typeof identityCatalog.transition === 'function' &&
    typeof config === 'object' &&
    config !== null &&
    'read' in config &&
    typeof config.read === 'function' &&
    'write' in config &&
    typeof config.write === 'function'
  );
}

export function memoryAuthorityProvider(
  options: Pick<CreateStandaloneMemoryProfileOptions, 'clock' | 'acquireAuthority'>
) {
  const token = new ResourceToken('standalone.agent-authority', {
    parseBinding: parseAllocationBinding,
    isValue: isAuthority,
  });
  const clock = options.clock;
  const acquire = options.acquireAuthority;
  const provider = defineResourceProvider({
    token,
    dependencies: {},
    describe: describeAllocation,
    create: ({ binding, signal }) =>
      acquire === undefined
        ? {
            value: Object.freeze({
              identityCatalog: new MemoryAgentIdentityCatalogAdapter(
                clock === undefined ? {} : { clock }
              ),
              config: new MemoryAgentConfigAdapter(),
            }),
          }
        : acquire({ ...binding, signal }),
  });
  return { token, provider };
}
