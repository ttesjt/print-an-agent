import { MemorySessionAdapter } from '../../src/index.js';
import { defineSessionPortContract } from '../support/session-port-contract.js';

function createClock(): () => number {
  let current = 100;
  return () => ++current;
}

defineSessionPortContract('MemorySessionAdapter', () => ({
  adapter: new MemorySessionAdapter({
    createSessionId: () => 'generated-session',
    clock: createClock(),
  }),
}));
