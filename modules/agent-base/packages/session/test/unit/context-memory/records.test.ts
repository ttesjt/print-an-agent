import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { expect, it } from 'vitest';
import { decideMemoryRecord, parseSessionId, supportsSessionMemory } from '../../../src/index.js';

const input = {
  agentId: parseAgentId('a'),
  sessionId: parseSessionId('s'),
  kind: 'turn' as const,
  id: 't',
  expectedRevision: null,
  settled: false,
  value: '{"format":1}',
};
it('keeps Memory capabilities optional', () => {
  expect(supportsSessionMemory({})).toBe(false);
});
it('arbitrates coordination CAS without changing the old record', () => {
  const first = decideMemoryRecord(undefined, input);
  expect(first.revision).toBe(1);
  expect(() => decideMemoryRecord(first, input)).toThrow('Memory coordination revision changed.');
  expect(decideMemoryRecord(first, { ...input, expectedRevision: 1, settled: true }).revision).toBe(
    2
  );
  expect(first.settled).toBe(false);
});
it('rejects malformed keys and encodings before publication', () => {
  for (const invalid of [
    { ...input, id: '\ud800' },
    { ...input, value: 'not-json' },
    { ...input, expectedRevision: 0 },
  ])
    expect(() => decideMemoryRecord(undefined, invalid)).toThrow();
});
