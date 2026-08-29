import { defineExecutionSupport } from '@ta-agent/workbench-extension';

import { LOCAL_EXECUTION_PROTOCOL } from '../foundation/constants.js';
import { parseLocalRootDirectory } from '../foundation/paths.js';
import type { LocalExecutionSupport, LocalExecutionSupportOptions } from './contracts.js';
import {
  readLocalExecutionObservation,
  requestLocalExecutionCancellation,
} from './execution-files.js';
import { parseLocalExecutionReceipt } from './local-execution-receipt.js';

export function createLocalExecutionSupport(
  options: LocalExecutionSupportOptions
): LocalExecutionSupport {
  const rootDirectory = parseLocalRootDirectory(options.rootDirectory);

  return defineExecutionSupport({
    runtimeSupportId: options.runtimeSupportId,
    metadata: { protocol: LOCAL_EXECUTION_PROTOCOL },
    observe: ({ profileId, executionReceipt }, callOptions) =>
      readLocalExecutionObservation(
        rootDirectory,
        profileId,
        parseLocalExecutionReceipt(executionReceipt),
        callOptions?.signal
      ),
    cancel: ({ profileId, executionReceipt }, callOptions) =>
      requestLocalExecutionCancellation(
        rootDirectory,
        profileId,
        parseLocalExecutionReceipt(executionReceipt),
        callOptions?.signal
      ),
  });
}
