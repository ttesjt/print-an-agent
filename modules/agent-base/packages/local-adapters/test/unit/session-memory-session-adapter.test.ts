import { MemorySessionAdapter } from '../../src/index.js';
import { defineSessionPortContract } from '../support/session-port-contract.js';

defineSessionPortContract('MemorySessionAdapter', () => ({
  adapter: new MemorySessionAdapter(() => 'generated-session'),
}));
