import type { ToolCallId } from './identity.js';

export interface ToolExecutionRequest<TArguments> {
  readonly callId: ToolCallId;
  readonly arguments: TArguments;
  readonly signal: AbortSignal;
}

export interface ToolHandlerResult {
  readonly text: string;
}
