export type StepName = string;
export const STEP_CARDINALITY = Object.freeze({
  AT_MOST_ONCE: 'at-most-once',
  REPEATABLE: 'repeatable',
} as const);
export type StepCardinality = (typeof STEP_CARDINALITY)[keyof typeof STEP_CARDINALITY];
export const SKIP_STEP = Symbol('SKIP_STEP');

export type Step<C> = (context: C) => Promise<void>;
export interface StepDefinition<C> {
  readonly step?: Step<C>;
  readonly skippable: boolean;
  readonly cardinality: StepCardinality;
}
export type StepDefinitions<N extends string, C> = Readonly<Record<N, StepDefinition<C>>>;
export interface StepOverrideDefinition<C> {
  readonly step?: Step<C> | typeof SKIP_STEP;
  readonly cardinality?: StepCardinality;
}
export type StepOverride<C> = Step<C> | StepOverrideDefinition<C> | typeof SKIP_STEP | undefined;
export type StepOverrides<N extends string, C> = Readonly<Partial<Record<N, StepOverride<C>>>>;
export type ResolvedStep<C> =
  | Readonly<{ status: 'active'; step: Step<C>; cardinality: StepCardinality; skippable: boolean }>
  | Readonly<{ status: 'skipped'; cardinality: StepCardinality; skippable: boolean }>;
export type ResolvedStepRegistry<N extends string, C> = Readonly<Record<N, ResolvedStep<C>>>;
export interface StepExecution<N extends string, C> {
  readonly stepName: N;
  readonly step: Step<C>;
  readonly context: C;
}
/** May retry the implementation serially. All started attempts must settle before returning. */
export type StepExecutor<N extends string, C> = (execution: StepExecution<N, C>) => Promise<void>;
