import type { AgentWebConfig } from './agent-config.js';

/** Draft dirtiness compares values, not the serialization order chosen by an adapter. */
export function sameAgentConfig(left: AgentWebConfig, right: AgentWebConfig): boolean {
  return sameValue(left, right);
}
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}
