export interface CapturedReasoningBlock {
  readonly modelTurnIndex: number;
  readonly chunks: string[];
}

/** Mutable Run-local buffer; only buildTurnPresentation creates the durable value. */
export interface CapturedReasoningPresentation {
  readonly blocks: CapturedReasoningBlock[];
  characterCount: number;
}
