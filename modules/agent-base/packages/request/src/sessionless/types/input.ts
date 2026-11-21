import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import type { SessionlessOutputSink } from './output.js';
export interface SessionlessRequestInput {
  readonly message: string;
  readonly history?: readonly ModelMessage[];
}

export interface SessionlessValidatedRequest extends SessionlessRequestInput {
  readonly history: readonly ModelMessage[];
  readonly outputSink?: SessionlessOutputSink;
}
