export interface SkippedRetrieval {
  readonly status: 'skipped';
  readonly reason: string;
}

export type RetrievalReadOutcome<O> =
  | { readonly status: 'completed'; readonly value: O }
  | SkippedRetrieval;
