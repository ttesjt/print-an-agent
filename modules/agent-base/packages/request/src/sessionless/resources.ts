import { AgentRequestError } from '../errors.js';
import { closedRecord, defineSessionlessGenerationPolicy } from './validation.js';
import type {
  BoundSessionlessGenerationResources,
  SessionlessGenerationResources,
} from './contracts.js';

export function bindGenerationResources(
  input: SessionlessGenerationResources
): BoundSessionlessGenerationResources {
  closedRecord(
    input,
    ['actor', 'policy', 'instructionContributors', 'createOutputSink', 'clock'],
    'REQUEST_CONFIGURATION_INVALID'
  );
  const contributors: unknown = input.instructionContributors;
  if (
    !input.actor ||
    (input.clock !== undefined && typeof input.clock !== 'function') ||
    (input.createOutputSink !== undefined && typeof input.createOutputSink !== 'function') ||
    (contributors !== undefined &&
      (!Array.isArray(contributors) ||
        Array.from<unknown>(contributors).some((item) => typeof item !== 'function')))
  ) {
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Sessionless resources are invalid.'
    );
  }
  return Object.freeze({
    ...input,
    policy: defineSessionlessGenerationPolicy(input.policy),
    instructionContributors: Object.freeze([...(input.instructionContributors ?? [])]),
    clock: input.clock ?? Date.now,
  });
}
