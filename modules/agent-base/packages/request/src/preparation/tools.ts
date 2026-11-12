import {
  createBoundedToolRuntime,
  createToolRegistry,
  type ToolExecutionPolicy,
  type ToolPermissionPolicy,
  type ToolRegistry,
  type ToolRuntime,
} from '@print-an-agent/base-tool';
import { requireValue } from './state-value.js';

export interface ToolPreparationContext {
  readonly signal: AbortSignal;
  readonly state: {
    tools?: ToolRuntime;
    toolPermissionPolicy?: ToolPermissionPolicy;
    contextMemory?: {
      readonly tools: readonly import('@print-an-agent/base-tool').ToolDefinition[];
    };
  };
  readonly resources: {
    readonly toolRegistry: ToolRegistry;
    readonly toolExecutionPolicy: ToolExecutionPolicy;
    readonly clock: () => number;
  };
}

export function buildRequestTools(context: ToolPreparationContext): Promise<void> {
  context.state.tools = createBoundedToolRuntime({
    registry:
      context.state.contextMemory === undefined
        ? context.resources.toolRegistry
        : createToolRegistry([
            ...context.resources.toolRegistry.list(),
            ...context.state.contextMemory.tools,
          ]),
    permissionPolicy: requireValue(context.state.toolPermissionPolicy, 'toolPermissionPolicy'),
    executionPolicy: context.resources.toolExecutionPolicy,
    signal: context.signal,
    clock: context.resources.clock,
  });
  return Promise.resolve();
}
