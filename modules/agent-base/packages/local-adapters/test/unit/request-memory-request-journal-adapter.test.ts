import { AgentRequestError, createRequestFingerprint } from '@print-an-agent/base-request';
import { describe, expect, it } from 'vitest';
import { MemoryRequestJournalAdapter } from '../../src/index.js';
import {
  defineRequestJournalContract,
  journalReference,
} from '../support/request-journal-contract.js';

defineRequestJournalContract('MemoryRequestJournalAdapter', () => ({
  journal: new MemoryRequestJournalAdapter(() => 100),
}));

describe('MemoryRequestJournalAdapter validation', () => {
  it('rejects an invalid clock result', async () => {
    const journal = new MemoryRequestJournalAdapter(() => -1);

    await expect(
      journal.claim({
        ...journalReference(),
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'request-1',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({
        code: 'REQUEST_REPLAY_CONFIGURATION_INVALID',
      })
    );
  });

  it('rejects invalid request and failure records at its boundary', async () => {
    const reference = journalReference();
    const journal = new MemoryRequestJournalAdapter(() => 1);

    await expect(
      journal.claim({
        ...reference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'invalid request id',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({
        code: 'REQUEST_REPLAY_REQUEST_ID_INVALID',
      })
    );

    await journal.claim({
      ...reference,
      fingerprint: createRequestFingerprint({ message: 'hello' }),
      requestId: 'request-1',
    });
    await expect(
      journal.fail({
        ...reference,
        requestId: 'request-1',
        failure: { code: 'INVALID CODE', message: '' },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({
        code: 'REQUEST_REPLAY_FAILURE_INVALID',
      })
    );
  });
});
