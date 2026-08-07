import { MemoryRequestJournalAdapter } from '../../src/index.js';
import { defineRequestJournalContract } from '../support/request-journal-contract.js';

defineRequestJournalContract('MemoryRequestJournalAdapter', () => ({
  journal: new MemoryRequestJournalAdapter(() => 100),
}));
