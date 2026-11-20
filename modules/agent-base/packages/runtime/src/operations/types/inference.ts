import type { AgentOperationDefinitionMap } from './definition.js';

export type AgentOperationInputFromDefinition<TDefinition> =
  TDefinition extends Readonly<{
    reference: Readonly<{ contract: Readonly<{ input: infer TInput }> }>;
  }>
    ? TInput
    : never;

export type AgentOperationOutputFromDefinition<TDefinition> =
  TDefinition extends Readonly<{
    reference: Readonly<{ contract: Readonly<{ output: infer TOutput }> }>;
  }>
    ? TOutput
    : never;

export type PublicAgentOperationName<TDefinitions extends AgentOperationDefinitionMap> = {
  [TName in keyof TDefinitions]: TDefinitions[TName] extends Readonly<{
    exposure: 'public';
  }>
    ? TName
    : never;
}[keyof TDefinitions] &
  string;
