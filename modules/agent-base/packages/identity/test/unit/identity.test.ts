import { describe, expect, it } from 'vitest';
import type { AgentIdentityError } from '../../src/index.js';
import { defineAgentIdentity, isAgentId, parseAgentId } from '../../src/index.js';

function expectIdentityError(run: () => unknown, code: AgentIdentityError['code']): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected AgentIdentityError with code ${code}.`);
}

describe('Agent identity', () => {
  it('creates an immutable identity with a default display name', () => {
    const identity = defineAgentIdentity({ id: 'bro-01' });

    expect(identity).toEqual({ id: 'bro-01', displayName: 'bro-01' });
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('supports a Unicode display name independently from the stable ID', () => {
    expect(defineAgentIdentity({ id: 'mochi', displayName: '麻薯' })).toEqual({
      id: 'mochi',
      displayName: '麻薯',
    });
  });

  it.each(['', 'Bro', 'two words', '-agent', 'agent-', 'agent..one', 'agent__one'])(
    'rejects invalid Agent ID %j',
    (id) => {
      expectIdentityError(() => parseAgentId(id), 'AGENT_ID_INVALID');
    }
  );

  it('rejects empty or control-character display names', () => {
    expectIdentityError(
      () => defineAgentIdentity({ id: 'agent', displayName: '  ' }),
      'AGENT_DISPLAY_NAME_INVALID'
    );
    expectIdentityError(
      () => defineAgentIdentity({ id: 'agent', displayName: 'line\nbreak' }),
      'AGENT_DISPLAY_NAME_INVALID'
    );
  });

  it('exposes a runtime Agent ID guard', () => {
    expect(isAgentId('valid_agent')).toBe(true);
    expect(isAgentId('invalid.agent')).toBe(false);
    expect(isAgentId(42)).toBe(false);
  });
});
