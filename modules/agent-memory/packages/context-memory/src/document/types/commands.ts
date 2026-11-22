import type { MemoryItem } from '../../types/document.js';
import type { CommandOutcome } from '../../types/receipt.js';

export type ItemContent = Omit<MemoryItem, 'id'>;

export type ItemCommand =
  | (ItemContent & { readonly op: 'add' })
  | (ItemContent & { readonly op: 'replace'; readonly itemId: string })
  | { readonly op: 'remove'; readonly itemId: string };

export interface AppliedCommands {
  readonly items: readonly MemoryItem[];
  readonly commandOutcomes: readonly CommandOutcome[];
}
