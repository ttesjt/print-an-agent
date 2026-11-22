import type { ModelMemoryContext, ModelMemoryStepName } from './workflow.js';

export type ModelMemorySteps = {
  readonly [Name in Exclude<ModelMemoryStepName, 'runModelOperation'>]: (
    this: void,
    context: ModelMemoryContext
  ) => Promise<void>;
};
