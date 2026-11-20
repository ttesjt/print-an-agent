import type { ManagedAgentCompositionCapabilitiesInput } from './definition.js';

type ManagedAgentCompositionCapabilityKey = keyof ManagedAgentCompositionCapabilitiesInput<unknown>;

/**
 * Preserve the caller's known capability fields without re-evaluating generic core constraints.
 * Required, optional, and absent fields therefore retain their exact presence semantics.
 */
export type ManagedAgentCompositionCapabilitiesFromInput<TInput> = Readonly<
  Pick<TInput, Extract<keyof TInput, ManagedAgentCompositionCapabilityKey>>
>;

export type RejectUnknownDefinitionFields<TAllowed, TInput> = Readonly<
  Record<Exclude<keyof TInput, keyof TAllowed>, never>
>;

export type ManagedAgentDefinitionConfig<TDefinition> =
  TDefinition extends Readonly<{
    config: Readonly<{ codec: Readonly<{ decode(value: unknown): infer TConfig }> }>;
  }>
    ? TConfig
    : never;

export type ManagedAgentDefinitionRuntimePorts<TDefinition> =
  TDefinition extends Readonly<{
    runtime: Readonly<{ createPorts: (...input: never[]) => infer TRuntimePorts }>;
  }>
    ? Awaited<TRuntimePorts>
    : never;

export type MaterializedManagedAgent<TDefinition> =
  TDefinition extends Readonly<{
    runtime: Readonly<{ materialize: (...input: never[]) => infer TResult }>;
  }>
    ? Awaited<TResult>
    : never;
