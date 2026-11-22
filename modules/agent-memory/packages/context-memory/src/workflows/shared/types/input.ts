export interface MemoryInputView<I> {
  readonly input: I;
  readonly preparedInput: I | undefined;
}

export interface DeterministicMemoryWorkflowInput<I> extends MemoryInputView<I> {
  /** Optionally prepare a replacement of the same operation's input type. */
  readonly prepareInput: (replacement?: I) => void;
}

export interface ModelMemoryWorkflowInput<I> extends MemoryInputView<I> {
  /** Validate and detach this run's input; an override cannot replace it with another operation's input. */
  readonly prepareInput: () => void;
}
