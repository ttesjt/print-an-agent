import type { JsonValue } from '@ta-agent/workbench-domain';
import type { OutputInvocation } from '@ta-agent/workbench-extension';

import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface InvokeOutputInput {
  readonly profileId: string;
  readonly outputId: string;
  readonly outputInvokerId: string;
  readonly input: unknown;
}

export interface OutputInvocationOperations {
  invoke(
    input: InvokeOutputInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<OutputInvocation<JsonValue>>;
}
