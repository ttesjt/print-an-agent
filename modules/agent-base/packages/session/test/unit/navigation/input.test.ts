import { describe, expect, it, vi } from 'vitest';
import { executeSessionNavigation } from '../../../src/index.js';
import {
  agentId,
  createSnapshot,
  sessionId,
} from '../../support/navigation/coordinator-fixtures.js';
import { createSessionPortStub } from '../../support/session-port-stub.js';

describe('Session navigation coordinator input', () => {
  it('rejects malformed records without evaluating accessors or touching the port', async () => {
    let getterRead = false;
    const navigation = { sessionId } as { sessionId: string; operation?: 'inspect' };
    Object.defineProperty(navigation, 'operation', {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 'inspect' as const;
      },
    });
    const inspect = vi.fn(() => Promise.resolve(createSnapshot()));

    await expect(
      executeSessionNavigation({
        agentId,
        navigation: navigation as never,
        session: createSessionPortStub({ inspect }),
      })
    ).rejects.toMatchObject({ code: 'SESSION_NAVIGATION_INVALID' });
    expect(getterRead).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });
});
