import type { TextTokenInput, TokenCounter } from '@print-an-agent/model-invocation-core';
import type {
  ExecutionPolicy,
  MemoryPlanner,
  MemoryUpdatePort,
  MemoryCompactionFeedback,
} from '../../../model-update/index.js';
import type { MemoryMutationResources } from '../../../mutations/index.js';
import type { MemoryWorkflowResources } from '../../deterministic/index.js';

export interface ModelMemoryResources extends MemoryWorkflowResources {
  readonly updates: MemoryUpdatePort;
  readonly planner: MemoryPlanner;
  readonly policy: ExecutionPolicy;
  readonly refine: (feedback: MemoryCompactionFeedback) => number | Promise<number>;
  /** Only for the optional experience/instruction input budget, not output acceptance. */
  readonly inputCounter?: TokenCounter<TextTokenInput>;
}

export interface ModelMemoryResourceOptions extends MemoryMutationResources {
  readonly planner: MemoryPlanner;
  readonly policy?: Partial<ExecutionPolicy>;
  readonly refine?: ModelMemoryResources['refine'];
  readonly inputCounter?: TokenCounter<TextTokenInput>;
}
