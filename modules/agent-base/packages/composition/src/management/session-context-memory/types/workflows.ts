import type { createVersionedContextMemoryBundle } from '@print-an-agent/context-memory';

type BundledMemoryWorkflows = ReturnType<typeof createVersionedContextMemoryBundle>['workflows'];
export type ContextMemoryWorkflows = {
  readonly [K in
    | 'inspect'
    | 'create'
    | 'apply'
    | 'getReceipt'
    | 'inspectVersion'
    | 'readVersionContext'
    | 'fork']: Pick<BundledMemoryWorkflows[K], 'run'>;
};
