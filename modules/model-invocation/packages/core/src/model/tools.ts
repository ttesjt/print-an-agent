/** Declarative model-facing schemas; executable tools and permissions belong to consumers. */
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

// All-required objects retain a homomorphic mapping for generic typed consumers.
type ToolObjectSchemaValue<
  P extends Readonly<Record<string, ToolValueSchema>>,
  R extends readonly string[],
> = keyof P extends R[number]
  ? Readonly<{ [K in keyof P]: ToolSchemaValue<P[K]> }>
  : Readonly<
      {
        [K in keyof P as K extends R[number] ? K : never]: ToolSchemaValue<P[K]>;
      } & {
        [K in keyof P as K extends R[number] ? never : K]?: ToolSchemaValue<P[K]>;
      }
    >;

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
          : S extends ToolObjectSchema
            ? ToolObjectSchemaValue<S['properties'], S['required']>
            : never;
export interface ToolDescriptor {
  readonly name: string;
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
export interface ToolExecutionOptions {
  readonly signal?: AbortSignal;
}
/** Borrowed capability. The consumer owns permissions, budgets, cancellation and disposal. */
export interface InteractionTools {
  readonly tools: readonly ToolDescriptor[];
  execute(
    proposal: ToolCallProposal,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionOutcome>;
}
