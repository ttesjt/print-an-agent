declare const toolNameBrand: unique symbol;
declare const toolCallIdBrand: unique symbol;

export type ToolName = string & { readonly [toolNameBrand]: 'ToolName' };
export type ToolCallId = string & { readonly [toolCallIdBrand]: 'ToolCallId' };

export interface ToolStringSchema {
  readonly type: 'string';
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly enum?: readonly string[];
}

export interface ToolNumberSchema {
  readonly type: 'number';
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ToolIntegerSchema {
  readonly type: 'integer';
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ToolBooleanSchema {
  readonly type: 'boolean';
}

export interface ToolNullSchema {
  readonly type: 'null';
}

export interface ToolArraySchema {
  readonly type: 'array';
  readonly items: ToolValueSchema;
  readonly maxItems?: number;
}

export interface ToolObjectSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolValueSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export type ToolValueSchema =
  | ToolStringSchema
  | ToolNumberSchema
  | ToolIntegerSchema
  | ToolBooleanSchema
  | ToolNullSchema
  | ToolArraySchema
  | ToolObjectSchema;

export type ToolSchemaValue<S extends ToolValueSchema> = S extends ToolStringSchema
  ? string
  : S extends ToolNumberSchema | ToolIntegerSchema
    ? number
    : S extends ToolBooleanSchema
      ? boolean
      : S extends ToolNullSchema
        ? null
        : S extends { readonly type: 'array'; readonly items: infer I extends ToolValueSchema }
          ? readonly ToolSchemaValue<I>[]
          : S extends {
                readonly type: 'object';
                readonly properties: infer P extends Readonly<Record<string, ToolValueSchema>>;
              }
            ? Readonly<{ [K in keyof P]: ToolSchemaValue<P[K]> }>
            : never;

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

export interface ToolDescriptor {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: ToolObjectSchema;
}

export interface ToolCallProposal {
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: unknown;
}

export type ToolExecutionOutcome =
  | Readonly<{ status: 'success'; text: string }>
  | Readonly<{ status: 'handler-error'; text: string }>;

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

export interface ToolRuntime {
  readonly tools: readonly ToolDescriptor[];
  execute(proposal: ToolCallProposal): Promise<ToolExecutionOutcome>;
  close(): void;
  inspect(): ToolRunInspection;
}

export interface ToolRegistry {
  list(): readonly ToolDefinition[];
  get(name: ToolName): ToolDefinition | undefined;
}

export interface ToolPermissionPolicyInput {
  readonly task: readonly string[];
  readonly assignment: readonly string[];
  readonly product: readonly string[];
  readonly runtime: readonly string[];
}

export interface ToolPermissionPolicy {
  readonly task: readonly ToolName[];
  readonly assignment: readonly ToolName[];
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
