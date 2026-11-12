import type { JsonValue } from '@print-an-agent/workbench-domain';
import type { ExtensionCallOptions, OutputInvocation } from '@print-an-agent/workbench-extension';

import type { LocalCommandDefinition } from '../command-bridge/contracts.js';

export interface LocalOutputInvocationBridgeOptions {
  readonly command: LocalCommandDefinition;
  readonly maximumProtocolMessageBytes?: number;
  readonly maximumStderrBytes?: number;
  readonly cancellationGraceMilliseconds?: number;
}

export interface LocalOutputInvocationBridge {
  invoke(request: unknown, options?: ExtensionCallOptions): Promise<OutputInvocation<JsonValue>>;
}
