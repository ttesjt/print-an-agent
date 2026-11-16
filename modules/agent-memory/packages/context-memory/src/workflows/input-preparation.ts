import { ContextMemoryError } from '../errors.js';
import { jsonValue } from '../validation/value.js';

interface MemoryInputView<I> {
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

export function createMemoryInputPreparation<I>(input: I): DeterministicMemoryWorkflowInput<I> {
  let preparedInput: I | undefined;
  return {
    get input() {
      return input;
    },
    get preparedInput() {
      return preparedInput;
    },
    prepareInput(replacement = input) {
      jsonValue(replacement);
      preparedInput = structuredClone(replacement);
    },
  };
}

export function createModelMemoryInputState<I, S extends object>(
  input: I,
  state: S
): S & ModelMemoryWorkflowInput<I> {
  const preparation = createMemoryInputPreparation(input);
  return {
    ...state,
    get input() {
      return input;
    },
    get preparedInput() {
      return preparation.preparedInput;
    },
    prepareInput() {
      if (preparation.preparedInput === undefined) preparation.prepareInput();
    },
  };
}

export function requirePreparedMemoryInput<I>(state: MemoryInputView<I>): I {
  const { preparedInput } = state;
  if (preparedInput === undefined)
    throw new ContextMemoryError('INPUT_INVALID', 'Prepared input is missing.');
  return preparedInput;
}
