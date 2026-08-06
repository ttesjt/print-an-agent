import type { AnyWorkflowContext } from './context.js';

export type StepName = string;

export type Step<C extends AnyWorkflowContext> = (context: C) => Promise<void>;

export interface StepDefinition<C extends AnyWorkflowContext> {
  readonly step?: Step<C>;
  readonly skippable: boolean;
}

export type StepDefinitions<TStepName extends StepName, C extends AnyWorkflowContext> = Readonly<
  Record<TStepName, StepDefinition<C>>
>;

export type SkipStep = typeof import('../skip-step.js').SKIP_STEP;

export type StepOverride<C extends AnyWorkflowContext> = Step<C> | SkipStep | undefined;

export type StepOverrides<TStepName extends StepName, C extends AnyWorkflowContext> = Readonly<
  Partial<Record<TStepName, StepOverride<C>>>
>;

export type ResolvedStep<C extends AnyWorkflowContext> =
  | Readonly<{ status: 'active'; step: Step<C> }>
  | Readonly<{ status: 'skipped' }>;

export type ResolvedStepRegistry<
  TStepName extends StepName,
  C extends AnyWorkflowContext,
> = Readonly<Record<TStepName, ResolvedStep<C>>>;

export interface StepExecution<TStepName extends StepName, C extends AnyWorkflowContext> {
  readonly stepName: TStepName;
  readonly step: Step<C>;
  readonly context: C;
}

export type StepExecutor<TStepName extends StepName, C extends AnyWorkflowContext> = (
  execution: StepExecution<TStepName, C>
) => Promise<void>;
