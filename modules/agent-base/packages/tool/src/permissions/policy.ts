import type { ToolDefinition } from '../definition/index.js';
import { parseToolName } from '../definition/index.js';
import { AgentToolError } from '../errors.js';
import type { ToolRegistry } from '../registry/index.js';
import type { ToolName } from '../types/identity.js';
import type { ToolPermissionPolicy, ToolPermissionPolicyInput } from './types.js';

const POLICY_LAYERS = Object.freeze(['responsibility', 'actor', 'product', 'runtime'] as const);

function parseAllowList(values: readonly string[], layer: string): readonly ToolName[] {
  const parsed = values.map(parseToolName);
  if (new Set(parsed).size !== parsed.length) {
    throw new AgentToolError(
      'TOOL_POLICY_INVALID',
      `${layer} tool allow-list contains duplicates.`
    );
  }
  return Object.freeze(parsed);
}

export function defineToolPermissionPolicy(input: ToolPermissionPolicyInput): ToolPermissionPolicy {
  return Object.freeze({
    responsibility: parseAllowList(input.responsibility, 'responsibility'),
    actor: parseAllowList(input.actor, 'actor'),
    product: parseAllowList(input.product, 'product'),
    runtime: parseAllowList(input.runtime, 'runtime'),
  });
}

export const DENY_ALL_TOOL_PERMISSION_POLICY: ToolPermissionPolicy = defineToolPermissionPolicy({
  responsibility: [],
  actor: [],
  product: [],
  runtime: [],
});

export function resolveEffectiveTools(
  registry: ToolRegistry,
  policy: ToolPermissionPolicy
): readonly ToolDefinition[] {
  const registered = registry.list();
  const registeredNames = new Set(registered.map((tool) => tool.name));
  for (const layer of POLICY_LAYERS) {
    const unknown = policy[layer].find((name) => !registeredNames.has(name));
    if (unknown !== undefined) {
      throw new AgentToolError(
        'TOOL_POLICY_INVALID',
        `${layer} policy references unregistered tool "${unknown}".`
      );
    }
  }
  const allowed = POLICY_LAYERS.map((layer) => new Set(policy[layer]));
  return Object.freeze(registered.filter((tool) => allowed.every((names) => names.has(tool.name))));
}
