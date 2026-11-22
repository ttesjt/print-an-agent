/** Logical, store-scoped identity. Physical history representation is not part of this reference. */
export interface MemoryVersionReference {
  readonly memoryId: string;
  readonly revision: number;
}
