export const STEP_CARDINALITY = Object.freeze({
  AT_MOST_ONCE: 'at-most-once',
  REPEATABLE: 'repeatable',
} as const);
export type StepCardinality = (typeof STEP_CARDINALITY)[keyof typeof STEP_CARDINALITY];
export const SKIP_STEP = Symbol('SKIP_STEP');
