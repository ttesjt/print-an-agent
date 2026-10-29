import { array, integer, literal, object, optional, union } from '@ta-agent/ui-transport';
import {
  content,
  id,
  measurementFields,
  metadata,
  mutation,
  number,
  query,
  targetFields,
} from './common.js';

const nullableLimit = union(integer(1), literal(null));
const tokenTarget = union(
  object({ maxTokens: integer(1) }),
  object({
    limitTokens: optional(integer(1)),
    ratio: optional(number(Number.MIN_VALUE, 1)),
    reserveTokens: optional(integer()),
  })
);
const render = union(
  object({ format: literal('text'), separator: content }),
  object({ format: literal('json') }),
  object({ format: literal('custom'), rendererRef: id, options: metadata })
);
const renderInput = union(
  object({ format: literal('text'), separator: optional(content) }),
  object({ format: literal('json') }),
  object({ format: literal('custom'), rendererRef: id, options: metadata })
);
const configFields = {
  measurementRef: id,
  render,
  maxContextTokens: nullableLimit,
  maxItems: nullableLimit,
  maxItemTokens: nullableLimit,
  compactionTarget: tokenTarget,
};
const config = object(configFields);
const configInput = object({
  measurementRef: optional(id),
  render: optional(renderInput),
  maxContextTokens: optional(nullableLimit),
  maxItems: optional(nullableLimit),
  maxItemTokens: optional(nullableLimit),
  compactionTarget: optional(tokenTarget),
});
const body = { content, metadata: optional(metadata) };
const item = object({ id, ...body });
const counts = object({ ...measurementFields, itemId: id, contentDigest: id });
const measured = object({
  ...measurementFields,
  rendererRef: id,
  renderDigest: id,
  itemsDigest: id,
  itemTokenCounts: array(counts),
});
export const contextSnapshot = object({
  memoryId: id,
  revision: integer(1),
  config,
  items: array(item),
  measurement: measured,
});
export const contextReceipt = object({
  memoryId: id,
  requestId: id,
  operation: union(
    literal('create'),
    literal('configure'),
    literal('apply'),
    literal('observe'),
    literal('edit'),
    literal('compact')
  ),
  inputDigest: id,
  status: union(literal('committed'), literal('unchanged')),
  previousRevision: union(integer(1), literal(null)),
  revision: integer(1),
  changes: object({
    addedItemIds: array(id),
    updatedItemIds: array(id),
    removedItemIds: array(id),
  }),
  commandOutcomes: array(
    object({
      commandIndex: integer(),
      outcome: union(
        literal('added'),
        literal('updated'),
        literal('removed'),
        literal('ignored'),
        literal('unchanged')
      ),
      itemId: optional(id),
    })
  ),
});
const preview = object({
  snapshot: contextSnapshot,
  text: content,
  measurement: measured,
  budget: union(
    object({ limit: literal(null), status: literal('unbounded') }),
    object({ limit: integer(1), status: union(literal('fits'), literal('exceeded')) })
  ),
});
export const contextCodecs = {
  inspect: { input: object(targetFields), output: query(union(contextSnapshot, literal(null))) },
  getReceipt: {
    input: object({ ...targetFields, requestId: id }),
    output: query(union(contextReceipt, literal(null))),
  },
  readContext: {
    input: object({
      ...targetFields,
      measurementRef: optional(id),
      maxTokens: optional(integer(1)),
      budgetPolicy: optional(union(literal('enforce'), literal('report'))),
    }),
    output: query(union(preview, literal(null))),
  },
  create: {
    input: object({
      ...targetFields,
      requestId: id,
      items: optional(array(object(body))),
      config: optional(configInput),
    }),
    output: mutation(contextReceipt),
  },
  apply: {
    input: object({
      ...targetFields,
      requestId: id,
      expectedRevision: integer(1),
      commands: array(
        union(
          object({ op: literal('add'), ...body }),
          object({ op: literal('replace'), itemId: id, ...body }),
          object({ op: literal('remove'), itemId: id })
        )
      ),
    }),
    output: mutation(contextReceipt),
  },
  configure: {
    input: object({
      ...targetFields,
      requestId: id,
      expectedRevision: integer(1),
      config: configInput,
    }),
    output: mutation(contextReceipt),
  },
} as const;
