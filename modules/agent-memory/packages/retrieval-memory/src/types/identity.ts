export interface SpaceInput {
  readonly memoryId: string;
}

export interface ReceiptInput extends SpaceInput {
  readonly requestId: string;
}

export interface EntryInput extends SpaceInput {
  readonly entryId: string;
}
