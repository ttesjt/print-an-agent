import type { ToolObjectSchema, ToolSchemaValue } from '@print-an-agent/model-invocation-core';
import type { ToolExecutionRequest, ToolHandlerResult } from '../types/handler.js';
import type { ToolName } from '../types/identity.js';

export interface ToolDefinition<S extends ToolObjectSchema = ToolObjectSchema> {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: S;
  readonly execute: (
    request: ToolExecutionRequest<ToolSchemaValue<S>>
  ) => Promise<ToolHandlerResult>;
}

export interface DefineToolInput<S extends ToolObjectSchema> {
  readonly name: string;
  readonly description: string;
  readonly parameters: S;
  readonly execute: (
    request: ToolExecutionRequest<ToolSchemaValue<S>>
  ) => Promise<ToolHandlerResult>;
}
