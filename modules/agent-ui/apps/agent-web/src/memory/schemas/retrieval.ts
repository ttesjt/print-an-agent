import {
  array,
  integer,
  literal,
  object,
  optional,
  union,
  type Decoder,
  fail,
} from '@print-an-agent/ui-transport';
import {
  content,
  id,
  measurement,
  metadata,
  mutation,
  number,
  query,
  targetFields,
} from './common.js';

export const indexFields = { embeddingRef: id, chunkerRef: id, metricRef: id };
export const retrievalSpace = object({
  memoryId: id,
  revision: integer(1),
  sequence: integer(),
  index: object({ ...indexFields, generationId: id, dimensions: integer(1) }),
});
const source = union(literal(null), object({ ref: content, label: optional(content) }));
export const retrievalSource = source;
const entryFields = { memoryId: id, entryId: id, revision: integer(1), metadata, source };
const entry = object({ ...entryFields, content });
const summary = object(entryFields);
const entryInput = { ...targetFields, entryId: id };
const writeInput = { ...entryInput, requestId: id, expectedRevision: integer(1) };
const bodyInput = { content, metadata: optional(metadata), source: optional(source) };
export const retrievalReceipt = object({
  memoryId: id,
  requestId: id,
  operation: union(
    literal('create'),
    literal('ingest'),
    literal('update'),
    literal('remove'),
    literal('reindex')
  ),
  inputDigest: id,
  outcome: union(literal('committed'), literal('unchanged')),
  previousSequence: integer(),
  sequence: integer(),
  spaceRevision: integer(1),
  generationId: id,
  entryId: union(id, literal(null)),
  entryRevision: union(integer(1), literal(null)),
  representationId: union(id, literal(null)),
});
type Scalar = string | number | boolean | null;
type Filter =
  | { readonly op: 'eq'; readonly path: readonly string[]; readonly value: Scalar }
  | { readonly op: 'in'; readonly path: readonly string[]; readonly values: readonly Scalar[] }
  | { readonly op: 'exists'; readonly path: readonly string[]; readonly value: boolean }
  | { readonly op: 'and'; readonly filters: readonly Filter[] };
const primitive = union(content, number(), literal(true), literal(false), literal(null));
function parseFilter(value: unknown, depth: number): Filter {
  if (depth > 16) return fail();
  const child: Decoder<Filter> = { decode: (input) => parseFilter(input, depth + 1) };
  return union(
    object({ op: literal('eq'), path: array(content), value: primitive }),
    object({ op: literal('in'), path: array(content), values: array(primitive) }),
    object({
      op: literal('exists'),
      path: array(content),
      value: union(literal(true), literal(false)),
    }),
    object({ op: literal('and'), filters: array(child) })
  ).decode(value);
}
const filter: Decoder<Filter> = { decode: (value) => parseFilter(value, 0) };
const ranking = object({
  metricRef: id,
  value: number(),
  order: literal('ascending'),
  strategyRef: id,
});
const hit = object({
  memoryId: id,
  entryId: id,
  entryRevision: integer(1),
  generationId: id,
  representationId: id,
  chunkId: id,
  ordinal: integer(),
  text: content,
  span: union(literal(null), object({ start: integer(), end: integer(1) })),
  source,
  ranking,
});
const searchFields = { space: retrievalSpace, hits: array(hit) };
const searchInput = { ...targetFields, query: content, filter: optional(filter) };
const citation = object({
  number: integer(1),
  entryId: id,
  entryRevision: integer(1),
  chunkId: id,
  representationId: id,
  source,
});
const preview = object({
  ...searchFields,
  text: content,
  citations: array(citation),
  rendererRef: id,
  measurement: union(measurement, literal(null)),
  outcome: union(literal('selected'), literal('empty'), literal('no-chunk-fits')),
});
export const retrievalCodecs = {
  inspect: { input: object(targetFields), output: query(retrievalSpace) },
  get: { input: object(entryInput), output: query(entry) },
  getReceipt: {
    input: object({ ...targetFields, requestId: id }),
    output: query(union(retrievalReceipt, literal(null))),
  },
  list: {
    input: object({ ...targetFields, limit: optional(integer(1)), cursor: optional(content) }),
    output: query(
      object({
        space: retrievalSpace,
        entries: array(summary),
        nextCursor: union(content, literal(null)),
      })
    ),
  },
  create: {
    input: object({ ...targetFields, requestId: id, index: object(indexFields) }),
    output: mutation(retrievalReceipt),
  },
  ingest: {
    input: object({ ...targetFields, requestId: id, ...bodyInput }),
    output: mutation(retrievalReceipt),
  },
  update: { input: object({ ...writeInput, ...bodyInput }), output: mutation(retrievalReceipt) },
  remove: { input: object(writeInput), output: mutation(retrievalReceipt) },
  reindex: { input: object(writeInput), output: mutation(retrievalReceipt) },
  search: {
    input: object({ ...searchInput, topK: optional(integer(1)) }),
    output: query(object(searchFields)),
  },
  readContext: {
    input: object({
      ...searchInput,
      candidates: optional(integer(1)),
      maxChunks: optional(integer(1)),
      maxTokens: optional(union(integer(1), literal(null))),
      rendererRef: optional(id),
      separator: optional(content),
    }),
    output: query(preview),
  },
} as const;
