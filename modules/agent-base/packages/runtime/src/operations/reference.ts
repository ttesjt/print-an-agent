import type { AgentOperationName } from '../types/invocation.js';

import { validateOperationName } from './validation.js';

export class AgentOperationReference<TName extends AgentOperationName, TInput, TOutput> {
  readonly name: TName;

  // The declaration retains the invocation contract for inference without a runtime value.
  declare readonly contract: Readonly<{ input: TInput; output: TOutput }>;

  constructor(name: TName) {
    this.name = name;
    Object.freeze(this);
  }
}

export function defineAgentOperationReference<
  const TName extends AgentOperationName,
  TInput,
  TOutput,
>(name: TName): AgentOperationReference<TName, TInput, TOutput> {
  validateOperationName(name);
  return new AgentOperationReference<TName, TInput, TOutput>(name);
}
