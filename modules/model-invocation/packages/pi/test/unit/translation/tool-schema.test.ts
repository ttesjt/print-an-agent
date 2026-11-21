import { expect, it } from 'vitest';
import { Check } from 'typebox/value';
import { toPiToolSchema } from '../../../src/translation/index.js';

it('preserves nested requirements, bounds and enums for SDK tool validation', () => {
  const schema = toPiToolSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      entries: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['read', 'write'] },
            count: { type: 'integer', minimum: 1, maximum: 3 },
            label: { type: 'string', minLength: 1, maxLength: 4 },
          },
          required: ['mode', 'count'],
        },
      },
      enabled: { type: 'boolean' },
    },
    required: ['entries'],
  });
  expect(Check(schema, { entries: [{ mode: 'read', count: 1 }] })).toBe(true);
  expect(
    Check(schema, { entries: [{ mode: 'write', count: 3, label: 'ok' }], enabled: true })
  ).toBe(true);
  for (const invalid of [
    {},
    { entries: [{ mode: 'read' }] },
    { entries: [{ mode: 'other', count: 1 }] },
    { entries: [{ mode: 'read', count: 1.5 }] },
    { entries: [{ mode: 'read', count: 4 }] },
    { entries: [{ mode: 'read', count: 1, label: '' }] },
    { entries: [{ mode: 'read', count: 1, extra: true }] },
    { entries: [], extra: true },
    {
      entries: [
        { mode: 'read', count: 1 },
        { mode: 'read', count: 1 },
        { mode: 'read', count: 1 },
      ],
    },
  ])
    expect(Check(schema, invalid)).toBe(false);
});

it('rejects an empty enum before starting a provider request', () => {
  expect(() => toPiToolSchema({ type: 'string', enum: [] })).toThrow(
    'String enum cannot be empty.'
  );
});
