import { describe, expect, it } from 'vitest';
import { scopedAgentMemoryId, validateMemoryIdentifier } from '../../../../src/index.js';

describe('Memory authority identities', () => {
  it('is stable, unambiguous and isolated from other Agents and storage namespaces', () => {
    const id = scopedAgentMemoryId('tenant', 'agent', '项目/notes');
    expect(id).toBe(scopedAgentMemoryId('tenant', 'agent', '项目/notes'));
    expect(id).not.toBe(scopedAgentMemoryId('other', 'agent', '项目/notes'));
    expect(id).not.toBe(scopedAgentMemoryId('tenant', 'other', '项目/notes'));
    expect(scopedAgentMemoryId('a,b', 'c', 'd')).not.toBe(scopedAgentMemoryId('a', 'b,c', 'd'));
  });
  it.each(['', '  ', '\0', '\ud800', 'a'.repeat(1025)])(
    'rejects invalid identities without coercion',
    (id) => {
      expect(() => validateMemoryIdentifier(id)).toThrow(TypeError);
    }
  );
  it('validates the final encoded scope, not just its pieces', () => {
    expect(() => scopedAgentMemoryId('a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400))).toThrow(
      TypeError
    );
    expect(validateMemoryIdentifier('é')).toBe('é');
  });
  it('allows explicitly unbounded identities but rejects invalid configured limits', () => {
    expect(validateMemoryIdentifier('a'.repeat(2000), null)).toHaveLength(2000);
    for (const limit of [0, -1, NaN, Infinity])
      expect(() => validateMemoryIdentifier('a', limit)).toThrow(TypeError);
  });
});
