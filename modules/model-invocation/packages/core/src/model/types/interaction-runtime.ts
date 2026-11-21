import type { ProviderModelReference, ResolvedExecutionTarget } from '../provider/index.js';
import type { ModelMessage, UserModelMessage, AssistantModelMessage } from '../messages/index.js';
import type { ModelInteractionEventSink } from '../events/index.js';
import type { InteractionTools } from './tools.js';

export interface ModelInteractionRequest {
  readonly target: ResolvedExecutionTarget;
  readonly instructions: string;
  readonly history: readonly ModelMessage[];
  readonly prompt: UserModelMessage;
  readonly tools: InteractionTools;
  readonly maxModelTurns: number;
  readonly maxOutputCharacters: number;
  readonly signal: AbortSignal;
  readonly emit: ModelInteractionEventSink;
}

export interface ModelInteractionResult {
  readonly message: AssistantModelMessage;
}

export interface ModelInteractionRuntime {
  resolveTarget(reference: ProviderModelReference): Promise<ResolvedExecutionTarget>;
  run(request: ModelInteractionRequest): Promise<ModelInteractionResult>;
}
