const aggregates = new WeakSet<AggregateError>();

/** Only flatten our own aggregates; arbitrary domain errors retain their identity. */
function distinctFailures(errors: readonly unknown[]): unknown[] {
  const result: unknown[] = [];
  const add = (error: unknown): void => {
    if (error instanceof AggregateError && aggregates.has(error)) {
      for (const child of error.errors as unknown[]) add(child);
    } else if (!result.includes(error)) result.push(error);
  };
  errors.forEach(add);
  return result;
}

export function combineFailures(errors: readonly unknown[]): unknown {
  const distinct = distinctFailures(errors);
  if (distinct.length === 1) return distinct[0];
  const aggregate = new AggregateError(distinct, 'Workflow execution or cleanup failed.', {
    cause: distinct[0],
  });
  aggregates.add(aggregate);
  return aggregate;
}
