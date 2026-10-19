import {
  createBoundedToolRuntime,
  type ToolExecutionPolicy,
  type ToolPermissionPolicy,
  type ToolRegistry,
  type ToolRuntime,
} from '@ta-agent/base-tool';
import { requireValue } from './state-value.js';

export interface ToolPreparationContext {
  readonly signal: AbortSignal;
  readonly state: { tools?: ToolRuntime; toolPermissionPolicy?: ToolPermissionPolicy };
  readonly resources: {
    readonly toolRegistry: ToolRegistry;
    readonly toolExecutionPolicy: ToolExecutionPolicy;
    readonly clock: () => number;
  };
}

export function buildRequestTools(context: ToolPreparationContext): Promise<void> {
  context.state.tools = createBoundedToolRuntime({
    registry: context.resources.toolRegistry,
    permissionPolicy: requireValue(context.state.toolPermissionPolicy, 'toolPermissionPolicy'),
    executionPolicy: context.resources.toolExecutionPolicy,
    signal: context.signal,
    clock: context.resources.clock,
  });
  return Promise.resolve();
}
