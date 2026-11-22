import type { JsonObject } from './json.js';
import type { RetrievalSpace } from './space.js';
import type { EntryRepresentation } from './representation.js';

export interface RetrievalSource {
  readonly ref: string;
  readonly label?: string;
}

export interface EntryBody {
  readonly content: string;
  readonly metadata?: JsonObject;
  readonly source?: RetrievalSource | null;
}

export interface RetrievalEntry {
  readonly memoryId: string;
  readonly entryId: string;
  readonly revision: number;
  readonly content: string;
  readonly metadata: JsonObject;
  readonly source: RetrievalSource | null;
}

export type EntrySummary = Omit<RetrievalEntry, 'content'>;

export interface StoredEntry {
  readonly entry: RetrievalEntry;
  readonly representation: EntryRepresentation;
}

export interface EntryPage {
  readonly space: RetrievalSpace;
  readonly entries: readonly EntrySummary[];
  readonly nextCursor: string | null;
}
