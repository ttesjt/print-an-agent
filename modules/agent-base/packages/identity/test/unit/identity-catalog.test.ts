import { MemoryAgentIdentityCatalogAdapter } from '../../src/index.js';
import { defineIdentityCatalogContract } from '../support/identity-catalog-contract.js';

function createClock(): () => number {
  let value = 100;
  return () => ++value;
}

defineIdentityCatalogContract('MemoryAgentIdentityCatalogAdapter', () => ({
  catalog: new MemoryAgentIdentityCatalogAdapter({ clock: createClock() }),
}));
