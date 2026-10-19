import { AgentRequestError } from '../errors.js';
import { requireValue } from './state-value.js';

export interface InstructionsStepContext<TRequest> {
  readonly state: { request?: TRequest; instructions?: string };
  readonly resources: {
    readonly instructionContributors: readonly ((context: {
      readonly request: TRequest;
    }) => string | Promise<string>)[];
    readonly policy: { readonly maxInstructionsCharacters: number };
  };
}

/** Composes caller instructions only. Actor and Responsibility instructions remain their owners'. */
export async function resolveRequestInstructions<TRequest>(
  context: InstructionsStepContext<TRequest>
): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const contributions: string[] = [];
  for (const contributor of context.resources.instructionContributors) {
    const contribution = (await contributor({ request })).trim();
    if (contribution.length > 0) contributions.push(contribution);
  }
  const instructions = contributions.join('\n\n');
  if (instructions.length > context.resources.policy.maxInstructionsCharacters) {
    throw new AgentRequestError(
      'REQUEST_INSTRUCTIONS_INVALID',
      `Resolved instructions exceed ${context.resources.policy.maxInstructionsCharacters} characters.`
    );
  }
  context.state.instructions = instructions;
}
