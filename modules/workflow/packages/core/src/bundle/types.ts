import type { RunnableWorkflow, WorkflowDefinition } from '../workflow/index.js';

/** A Core definition whose resource binding is supplied exclusively by its Bundle. */
export type BundleWorkflowDefinition<N extends string, I, S, R, O> = Omit<
  WorkflowDefinition<N, I, S, R, O>,
  'resources'
> & { readonly resources?: never };

type MemberParameters<D> =
  D extends BundleWorkflowDefinition<infer N, infer I, infer S, infer R, infer O>
    ? readonly [N, I, S, R, O]
    : never;

// Check each alternative independently: satisfying one arm of a member union is insufficient.
type InvalidMember<R, D> = D extends unknown
  ? [MemberParameters<D>] extends [never]
    ? D
    : [R] extends [MemberParameters<D>[3]]
      ? never
      : D
  : never;

type CheckedDefinitions<R, D> = {
  readonly [K in keyof D]: [InvalidMember<R, D[K]>] extends [never] ? D[K] : never;
};

/** Already-assembled members retain their individual input and result contracts. */
type BoundMember<D> = D extends unknown
  ? RunnableWorkflow<MemberParameters<D>[1], MemberParameters<D>[4]>
  : never;

export type BundleWorkflows<D> = {
  readonly [K in keyof D]: BoundMember<D[K]>;
};

export interface WorkflowBundleOptions<R, D extends object> {
  readonly resources: R;
  readonly workflows: D &
    CheckedDefinitions<NoInfer<R>, NoInfer<D>> &
    Readonly<Record<Extract<keyof D, symbol>, never>>;
}

export type WorkflowBundleDefinitionErrorCode =
  | 'WORKFLOW_BUNDLE_DEFINITION_INVALID'
  | 'WORKFLOW_BUNDLE_MEMBER_INVALID'
  | 'WORKFLOW_BUNDLE_RESOURCE_BINDING_FORBIDDEN';
