import { createBoundedToolRuntime, createToolRegistry } from '@print-an-agent/base-tool';
import { requireValue } from '../state-access.js';
import type { ToolPreparationContext } from './types/tools.js';

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
