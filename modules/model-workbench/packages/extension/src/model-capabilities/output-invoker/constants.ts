export const OutputInvocationKind = {
  Completed: 'completed',
  Streaming: 'streaming',
} as const;

export type OutputInvocationKind = (typeof OutputInvocationKind)[keyof typeof OutputInvocationKind];
