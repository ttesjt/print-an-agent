import type { ValidatedAgentRequest } from './input.js';

export interface InstructionContributorContext {
  readonly request: ValidatedAgentRequest;
}

export type InstructionContributor = (
  context: InstructionContributorContext
) => string | Promise<string>;
