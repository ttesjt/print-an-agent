import type {
  ToolExecutionPolicy,
  ToolPermissionPolicy,
  ToolRegistry,
  ToolRuntime,
} from '@print-an-agent/base-tool';

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
