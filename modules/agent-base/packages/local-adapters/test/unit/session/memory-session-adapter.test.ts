import { MemorySessionAdapter } from '../../../src/index.js';
import { defineSessionIdentityContract } from '../../support/session/identity-contract.js';
import { defineSessionPortContract } from '../../support/session/port-contract.js';

defineSessionIdentityContract('MemorySessionAdapter', (createSessionId) => ({
  adapter: new MemorySessionAdapter(createSessionId === undefined ? {} : { createSessionId }),
}));

function createClock(): () => number {
  let current = 100;
  return () => ++current;
}

defineSessionPortContract('MemorySessionAdapter', () => {
  let sequence = 0;
  return {
    adapter: new MemorySessionAdapter({
      createSessionId: () => `generated-session-${++sequence}`,
      clock: createClock(),
    }),
  };
});
