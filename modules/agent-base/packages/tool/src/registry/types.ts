import type { ToolDefinition } from '../definition/index.js';
import type { ToolName } from '../types/identity.js';

export interface ToolRegistry {
  list(): readonly ToolDefinition[];
  get(name: ToolName): ToolDefinition | undefined;
}
