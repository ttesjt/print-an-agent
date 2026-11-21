import { AgentToolError } from '../errors.js';
import type { ToolExecutionPolicy } from './types/policy.js';

const MAX_TIMEOUT_MILLISECONDS = 2_147_483_647;

export const DEFAULT_TOOL_EXECUTION_POLICY: ToolExecutionPolicy = Object.freeze({
  maxToolCalls: 4,
  toolTimeoutMilliseconds: 5_000,
  maxArgumentCharacters: 16_000,
  maxResultCharacters: 16_000,
  maxTotalResultCharacters: 32_000,
});

export function validateToolExecutionPolicy(policy: ToolExecutionPolicy): ToolExecutionPolicy {
  for (const [name, value] of Object.entries(policy)) {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      (name === 'toolTimeoutMilliseconds' && value > MAX_TIMEOUT_MILLISECONDS)
    ) {
      throw new AgentToolError(
        'TOOL_EXECUTION_POLICY_INVALID',
        `Tool execution policy "${name}" is outside its supported positive integer range.`
      );
    }
  }
  if (policy.maxResultCharacters > policy.maxTotalResultCharacters) {
    throw new AgentToolError(
      'TOOL_EXECUTION_POLICY_INVALID',
      'Per-result character limit cannot exceed the total result character limit.'
    );
  }
  return Object.freeze({ ...policy });
}
