import type { ToolDefinition } from '../definition/index.js';
import { AgentToolError } from '../errors.js';
import type { ToolName } from '../types/identity.js';
import type { ToolRegistry } from './types.js';

class ImmutableToolRegistry implements ToolRegistry {
  readonly #tools: readonly ToolDefinition[];
  readonly #byName: ReadonlyMap<ToolName, ToolDefinition>;

  constructor(tools: readonly ToolDefinition[]) {
    const byName = new Map<ToolName, ToolDefinition>();
    for (const tool of tools) {
      if (byName.has(tool.name)) {
        throw new AgentToolError(
          'TOOL_REGISTRY_DUPLICATE',
          `Tool registry contains duplicate name "${tool.name}".`
        );
      }
      byName.set(tool.name, tool);
    }
    this.#tools = Object.freeze([...tools]);
    this.#byName = byName;
  }

  list(): readonly ToolDefinition[] {
    return this.#tools;
  }

  get(name: ToolName): ToolDefinition | undefined {
    return this.#byName.get(name);
  }
}

export function createToolRegistry(tools: readonly ToolDefinition[]): ToolRegistry {
  return new ImmutableToolRegistry(tools);
}

export const EMPTY_TOOL_REGISTRY: ToolRegistry = createToolRegistry([]);
