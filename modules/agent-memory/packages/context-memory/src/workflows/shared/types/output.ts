export interface MemoryOperationOutput<O> {
  /** An operation can complete with undefined. The wrapper records that it ran. */
  operationOutput?: Readonly<{ value: O }>;
}
