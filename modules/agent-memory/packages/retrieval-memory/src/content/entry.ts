import type { RetrievalEntry } from '../types/entry.js';
import { exact, identifier, integer, record } from '../values/index.js';
import { entryBody } from './entry-body.js';
import { DEFAULT_RETRIEVAL_POLICY } from '../policy/index.js';

export function parseRetrievalEntry(value: unknown): RetrievalEntry {
  const data = record(value);
  exact(data, ['memoryId', 'entryId', 'revision', 'content', 'metadata', 'source']);
  return {
    memoryId: identifier(data.memoryId),
    entryId: identifier(data.entryId),
    revision: integer(data.revision),
    ...entryBody(data, { ...DEFAULT_RETRIEVAL_POLICY, maxEntryCodepoints: null }),
  };
}
