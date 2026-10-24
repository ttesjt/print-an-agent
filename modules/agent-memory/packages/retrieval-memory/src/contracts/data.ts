export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export interface RetrievalSource {
  readonly ref: string;
  readonly label?: string;
}
export interface IndexConfiguration {
  readonly embeddingRef: string;
  readonly chunkerRef: string;
  readonly metricRef: string;
}
export interface RetrievalSpace {
  readonly memoryId: string;
  readonly revision: number;
  readonly sequence: number;
  readonly index: IndexConfiguration & {
    readonly generationId: string;
    readonly dimensions: number;
  };
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
export interface ChunkContent {
  readonly text: string;
  readonly span: { readonly start: number; readonly end: number } | null;
}
export interface RetrievalChunk extends ChunkContent {
  readonly memoryId: string;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly generationId: string;
  readonly representationId: string;
  readonly chunkId: string;
  readonly ordinal: number;
  readonly vector: readonly number[];
}
export interface EntryRepresentation {
  readonly representationId: string;
  readonly embeddingRef: string;
  readonly chunkerRef: string;
  readonly metricRef: string;
  readonly chunks: readonly RetrievalChunk[];
}
export interface StoredEntry {
  readonly entry: RetrievalEntry;
  readonly representation: EntryRepresentation;
}
export type Primitive = string | number | boolean | null;
export type MetadataFilter =
  | { readonly op: 'eq'; readonly path: readonly string[]; readonly value: Primitive }
  | { readonly op: 'in'; readonly path: readonly string[]; readonly values: readonly Primitive[] }
  | { readonly op: 'exists'; readonly path: readonly string[]; readonly value: boolean }
  | { readonly op: 'and'; readonly filters: readonly MetadataFilter[] };
export interface RetrievalHit extends Omit<RetrievalChunk, 'vector'> {
  readonly source: RetrievalSource | null;
  readonly ranking: {
    readonly metricRef: string;
    readonly value: number;
    readonly order: 'ascending';
    readonly strategyRef: string;
  };
}
export interface SearchResult {
  readonly space: RetrievalSpace;
  readonly hits: readonly RetrievalHit[];
}
export interface EntryPage {
  readonly space: RetrievalSpace;
  readonly entries: readonly EntrySummary[];
  readonly nextCursor: string | null;
}
