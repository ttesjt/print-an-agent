import {
  parseRetrievalEntry,
  parseRetrievalSpace,
  RetrievalMemoryError,
  type RetrievalReceipt,
} from '@print-an-agent/retrieval-memory';
import type { RetrievalMemoryManagementInputs } from './types/operations.js';

type Operation = Exclude<keyof RetrievalMemoryManagementInputs, 'replay'>;
function invalid(): never {
  throw new RetrievalMemoryError('STORAGE_FAILED', 'Retrieval result scope or shape is invalid.');
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return invalid();
  return value;
}

/** Target boundary only. Native workflows retain content/index validation and publication ownership. */
export function validateRetrievalResult(
  operation: Operation,
  value: unknown,
  memoryId: string,
  entryId: string | undefined,
  accept: (receipt: unknown) => RetrievalReceipt
): void {
  const result = record(value);
  if (result.status === 'skipped') {
    if (typeof result.reason !== 'string') invalid();
    return;
  }
  if (result.status === 'committed' || result.status === 'unchanged') {
    if (!['create', 'ingest', 'update', 'remove', 'reindex'].includes(operation)) invalid();
    if (accept(result.receipt).outcome !== result.status) invalid();
    return;
  }
  if (
    result.status !== 'completed' ||
    ['create', 'ingest', 'update', 'remove', 'reindex'].includes(operation)
  )
    invalid();
  if (operation === 'getReceipt') {
    if (result.value !== undefined) accept(result.value);
    return;
  }
  if (operation === 'inspect') {
    if (parseRetrievalSpace(result.value).memoryId !== memoryId) invalid();
    return;
  }
  if (operation === 'get') {
    const entry = parseRetrievalEntry(result.value);
    if (entry.memoryId !== memoryId || entry.entryId !== entryId) invalid();
    return;
  }
  const data = record(result.value);
  if (parseRetrievalSpace(data.space).memoryId !== memoryId) invalid();
  if (operation === 'list') {
    for (const entry of array(data.entries)) {
      const row = record(entry);
      if (row.memoryId !== memoryId || 'content' in row) invalid();
    }
    return;
  }
  const hits = array(data.hits).map(record);
  for (const hit of hits) if (hit.memoryId !== memoryId) invalid();
  if (operation === 'readContext') {
    const citations = array(data.citations).map(record);
    if (citations.length !== hits.length) invalid();
    citations.forEach((citation, index) => {
      const hit = hits[index];
      if (
        hit === undefined ||
        citation.entryId !== hit.entryId ||
        citation.entryRevision !== hit.entryRevision ||
        citation.chunkId !== hit.chunkId ||
        citation.representationId !== hit.representationId
      )
        invalid();
    });
  }
}

export function retrievalDomainError(error: unknown): RetrievalMemoryError | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  let first: RetrievalMemoryError | undefined;
  while (pending.length !== 0) {
    const cause = pending.pop();
    if (!(cause instanceof Error) || seen.has(cause)) continue;
    seen.add(cause);
    if (cause instanceof RetrievalMemoryError) {
      first ??= cause;
      if (cause.code === 'CLEANUP_FAILED') return cause;
    }
    const children: unknown[] =
      cause instanceof AggregateError
        ? [...(cause.errors as unknown[]), cause.cause]
        : [cause.cause];
    pending.push(...children.reverse());
  }
  return first;
}
