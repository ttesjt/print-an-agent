import type {
  ToolDefinition,
  ToolName,
  ToolPermissionPolicy,
  ToolPermissionPolicyInput,
  ToolRegistry,
} from './contracts.js';
import { AgentToolError } from './errors.js';
import { parseToolName } from './schema.js';

const POLICY_LAYERS = Object.freeze(['task', 'assignment', 'product', 'runtime'] as const);

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
    task: parseAllowList(input.task, 'task'),
    assignment: parseAllowList(input.assignment, 'assignment'),
    product: parseAllowList(input.product, 'product'),
    runtime: parseAllowList(input.runtime, 'runtime'),
  });
}

export const DENY_ALL_TOOL_PERMISSION_POLICY: ToolPermissionPolicy = defineToolPermissionPolicy({
  task: [],
  assignment: [],
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
