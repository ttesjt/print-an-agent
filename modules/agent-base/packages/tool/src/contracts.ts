import type {
  InteractionTools,
  ToolDescriptor,
  ToolObjectSchema,
  ToolSchemaValue,
} from '@print-an-agent/model-invocation-core';
declare const toolNameBrand: unique symbol;
declare const toolCallIdBrand: unique symbol;

export type ToolName = string & { readonly [toolNameBrand]: 'ToolName' };
export type ToolCallId = string & { readonly [toolCallIdBrand]: 'ToolCallId' };

export interface ToolExecutionRequest<TArguments> {
  readonly callId: ToolCallId;
  readonly arguments: TArguments;
  readonly signal: AbortSignal;
}

export interface ToolHandlerResult {
  readonly text: string;
}

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

export type ToolRunRecordStatus = 'success' | 'handler-error' | 'rejected';

export interface ToolRunRecord {
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly status: ToolRunRecordStatus;
  readonly resultCharacters: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly errorCode?: string;
}

export interface ToolRunInspection {
  readonly status: 'open' | 'closed';
  readonly effectiveTools: readonly ToolDescriptor[];
  readonly records: readonly ToolRunRecord[];
  readonly totalResultCharacters: number;
}

export interface ToolRuntime extends InteractionTools {
  close(): void;
  inspect(): ToolRunInspection;
}

export interface ToolRegistry {
  list(): readonly ToolDefinition[];
  get(name: ToolName): ToolDefinition | undefined;
}

export interface ToolPermissionPolicyInput {
  readonly responsibility: readonly string[];
  readonly actor: readonly string[];
  readonly product: readonly string[];
  readonly runtime: readonly string[];
}

export interface ToolPermissionPolicy {
  readonly responsibility: readonly ToolName[];
  readonly actor: readonly ToolName[];
  readonly product: readonly ToolName[];
  readonly runtime: readonly ToolName[];
}

export interface ToolExecutionPolicy {
  readonly maxToolCalls: number;
  readonly toolTimeoutMilliseconds: number;
  readonly maxArgumentCharacters: number;
  readonly maxResultCharacters: number;
  readonly maxTotalResultCharacters: number;
}
