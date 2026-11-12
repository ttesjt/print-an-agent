import { WorkflowBundle } from '@print-an-agent/workflow-bundle';
import type { RetrievalBackend } from '../contracts/ports.js';
import type { RetrievalPolicy } from '../config.js';
import { createRetrievalContentQueries } from '../domain/queries.js';
import { createRetrievalStateMutations } from '../domain/mutations.js';
import {
  createRetrievalInspectDefinition,
  createRetrievalGetDefinition,
  createRetrievalReceiptDefinition,
  createRetrievalListDefinition,
  createRetrievalRemoveDefinition,
} from './definitions.js';
import type { RetrievalExecutionPolicy } from './execution.js';

/** Independent, hackable content workflows; no representation or model resources required. */
export function createRetrievalContentBundle(options: {
  readonly backend: RetrievalBackend;
  readonly policy?: Partial<RetrievalPolicy>;
  readonly execution?: RetrievalExecutionPolicy;
  readonly workflows?: Partial<{
    inspect: ReturnType<typeof createRetrievalInspectDefinition>;
    get: ReturnType<typeof createRetrievalGetDefinition>;
    getReceipt: ReturnType<typeof createRetrievalReceiptDefinition>;
    list: ReturnType<typeof createRetrievalListDefinition>;
    remove: ReturnType<typeof createRetrievalRemoveDefinition>;
  }>;
}) {
  const resources = {
    queries: createRetrievalContentQueries(options, options.policy),
    mutations: createRetrievalStateMutations(options, options.policy),
    ...(options.execution === undefined ? {} : { execution: options.execution }),
  };
  return new WorkflowBundle({
    resources,
    workflows: {
      inspect: options.workflows?.inspect ?? createRetrievalInspectDefinition(),
      get: options.workflows?.get ?? createRetrievalGetDefinition(),
      getReceipt: options.workflows?.getReceipt ?? createRetrievalReceiptDefinition(),
      list: options.workflows?.list ?? createRetrievalListDefinition(),
      remove: options.workflows?.remove ?? createRetrievalRemoveDefinition(),
    },
  });
}
