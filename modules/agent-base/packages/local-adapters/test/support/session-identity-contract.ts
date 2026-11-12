import { parseAgentId } from '@print-an-agent/base-identity';
import { describe, expect, it, vi } from 'vitest';
import type { SessionPortContractHarness } from './session-port-contract.js';

export function defineSessionIdentityContract(
  name: string,
  create: (generate?: () => string) => SessionPortContractHarness
): void {
  const agentId = parseAgentId('identity-agent');
  describe(`${name} Session identity`, () => {
    it('generates distinct default UUIDs while titles remain mutable and non-unique', async () => {
      const { adapter, dispose } = create();
      try {
        const first = await adapter.resolve({ agentId });
        const second = await adapter.resolve({ agentId });
        expect(first.sessionId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
        expect(second.sessionId).not.toBe(first.sessionId);
        for (const reference of [first, second]) {
          const renamed = await adapter.renameSession({
            ...reference,
            title: 'Same readable name',
            expectedRevision: 0,
          });
          expect(renamed.sessionId).toBe(reference.sessionId);
          expect(renamed.title).toBe('Same readable name');
        }
        const reopened = await adapter.resolve({ agentId, sessionId: first.sessionId });
        expect(reopened).toEqual(first);
      } finally {
        dispose?.();
      }
    });

    it('never creates an unknown requested ID or invokes the generator while opening', async () => {
      const generate = vi.fn(() => '01ARZ3NDEKTSV4RRFFQ69G5FAV');
      const { adapter, dispose } = create(generate);
      try {
        await expect(adapter.resolve({ agentId, sessionId: 'unknown' })).rejects.toMatchObject({
          code: 'SESSION_NOT_FOUND',
        });
        expect(generate).not.toHaveBeenCalled();
        expect((await adapter.listSessions({ agentId })).records).toEqual([]);
        const session = await adapter.resolve({ agentId });
        const before = await adapter.inspectSession(session);
        await adapter.resolve({ agentId, sessionId: session.sessionId });
        expect(await adapter.inspectSession(session)).toEqual(before);
        expect(generate).toHaveBeenCalledTimes(1);
        await expect(
          adapter.resolve({
            agentId: parseAgentId('another-agent'),
            sessionId: session.sessionId,
          })
        ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
        expect(generate).toHaveBeenCalledTimes(1);
      } finally {
        dispose?.();
      }
    });

    it('rejects a generated collision instead of opening an existing Session, including across owners', async () => {
      const { adapter, dispose } = create(() => 'allocated-once');
      try {
        const session = await adapter.resolve({ agentId });
        const before = await adapter.inspectSession(session);
        for (const owner of [agentId, parseAgentId('another-agent')]) {
          await expect(adapter.resolve({ agentId: owner })).rejects.toMatchObject({
            code: 'SESSION_ID_CONFLICT',
          });
        }
        expect(await adapter.inspectSession(session)).toEqual(before);
        expect((await adapter.listSessions({ agentId })).records).toHaveLength(1);
        expect(
          (await adapter.listSessions({ agentId: parseAgentId('another-agent') })).records
        ).toEqual([]);
      } finally {
        dispose?.();
      }
    });

    it('admits only one concurrent creation when a broken generator repeats an ID', async () => {
      const { adapter, dispose } = create(() => 'duplicate');
      try {
        const outcomes = await Promise.allSettled([
          adapter.resolve({ agentId }),
          adapter.resolve({ agentId }),
        ]);
        expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
        const failure = outcomes.find((outcome) => outcome.status === 'rejected');
        expect(failure).toMatchObject({ reason: { code: 'SESSION_ID_CONFLICT' } });
        expect((await adapter.listSessions({ agentId })).records).toHaveLength(1);
      } finally {
        dispose?.();
      }
    });

    it('rejects invalid generated IDs without creating records', async () => {
      const { adapter, dispose } = create(() => '../invalid');
      try {
        await expect(adapter.resolve({ agentId })).rejects.toMatchObject({
          code: 'SESSION_ID_INVALID',
        });
        expect((await adapter.listSessions({ agentId })).records).toEqual([]);
      } finally {
        dispose?.();
      }
    });
  });
}
