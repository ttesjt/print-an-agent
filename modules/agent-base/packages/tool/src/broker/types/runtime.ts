import type { InteractionTools } from '@print-an-agent/model-invocation-core';
import type { ToolPermissionPolicy } from '../../permissions/index.js';
import type { ToolRegistry } from '../../registry/index.js';
import type { ToolRunInspection } from './inspection.js';
import type { ToolExecutionPolicy } from './policy.js';

export interface ToolRuntime extends InteractionTools {
  close(): void;
  inspect(): ToolRunInspection;
}

export interface CreateBoundedToolRuntimeOptions {
  readonly registry: ToolRegistry;
  readonly permissionPolicy: ToolPermissionPolicy;
  readonly executionPolicy: ToolExecutionPolicy;
  readonly signal: AbortSignal;
  readonly clock?: () => number;
}
