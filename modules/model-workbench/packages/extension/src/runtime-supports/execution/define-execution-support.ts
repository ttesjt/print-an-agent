import {
  deriveEvidenceDigest,
  parseJsonValue,
  parseRuntimeSupportId,
  type RuntimeSupportId,
} from '@ta-agent/workbench-domain';

import { parseExecutionObservation } from '../../execution-protocol/parsing.js';
import { RuntimeSupportKind, WorkbenchExtensionFamily } from '../../foundation/constants.js';
import type { WorkbenchExtensionRuntime } from '../../foundation/extension-runtime.js';
import {
  invalidExtension,
  parseDomainValue,
  parseExtensionMetadata,
} from '../../foundation/validation.js';
import type { CancelExecution, ObserveExecution } from './contracts.js';

export interface ExecutionSupportRuntime extends WorkbenchExtensionRuntime<
  typeof WorkbenchExtensionFamily.RuntimeSupport,
  typeof RuntimeSupportKind.Execution
> {
  readonly runtimeSupportId: RuntimeSupportId;
  readonly observe: ObserveExecution;
  readonly cancel: CancelExecution;
}

export interface ExecutionSupportRuntimeInput {
  readonly runtimeSupportId: string;
  readonly metadata?: unknown;
  readonly observe: (
    request: Parameters<ObserveExecution>[0],
    options?: Parameters<ObserveExecution>[1]
  ) => Promise<unknown>;
  readonly cancel: CancelExecution;
}

export function defineExecutionSupport(
  input: ExecutionSupportRuntimeInput
): ExecutionSupportRuntime {
  if (typeof input.observe !== 'function') {
    invalidExtension('executionSupport.observe', 'must be a function');
  }
  if (typeof input.cancel !== 'function') {
    invalidExtension('executionSupport.cancel', 'must be a function');
  }
  const runtimeSupportId = parseDomainValue(
    () => parseRuntimeSupportId(input.runtimeSupportId, 'executionSupport.runtimeSupportId'),
    'executionSupport.runtimeSupportId'
  );
  const metadata = parseExtensionMetadata(input.metadata, 'executionSupport.metadata');
  const evidence = parseJsonValue({
    family: WorkbenchExtensionFamily.RuntimeSupport,
    kind: RuntimeSupportKind.Execution,
    runtimeSupportId,
    ...(metadata === undefined ? {} : { metadata }),
  });

  return Object.freeze({
    family: WorkbenchExtensionFamily.RuntimeSupport,
    kind: RuntimeSupportKind.Execution,
    runtimeSupportId,
    ...(metadata === undefined ? {} : { metadata }),
    evidenceDigest: deriveEvidenceDigest(evidence),
    observe: async (
      request: Parameters<ObserveExecution>[0],
      options?: Parameters<ObserveExecution>[1]
    ) =>
      parseExecutionObservation(
        await input.observe(request, options),
        'executionSupport.observation'
      ),
    cancel: input.cancel,
  });
}
