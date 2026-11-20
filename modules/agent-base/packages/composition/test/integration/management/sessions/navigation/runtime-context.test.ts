import {
  SqliteRequestJournalAdapter,
  SqliteSessionAdapter,
} from '@print-an-agent/base-local-adapters';
import {
  DEFAULT_SESSION_BRANCH_ID,
  executeSessionNavigation,
  parseSessionBranchId,
  parseSessionId,
} from '@print-an-agent/base-session';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../../support/compaction-token-counter.js';

it('uses out-of-band navigation with branch-scoped runtime context and replay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-navigation-'));
  const sessionDatabasePath = join(directory, 'session.sqlite');
  const journalDatabasePath = join(directory, 'request-journal.sqlite');
  const childBranchId = parseSessionBranchId('child');
  let requestSequence = 0;
  try {
    const firstSession = new SqliteSessionAdapter({
      databasePath: sessionDatabasePath,
      clock: () => 10,
    });
    const first = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'navigation-assistant' },
      session: firstSession,
      requestJournal: new SqliteRequestJournalAdapter({
        databasePath: journalDatabasePath,
        clock: () => 11,
      }),
      createRunId: () => `branch-request-${++requestSequence}`,
      createCompactionRunId: () => 'branch-compaction',
      provider: {
        responses: [
          { status: 'success', text: 'PRIVATE_MAIN_ANSWER_1' },
          { status: 'success', text: 'PRIVATE_MAIN_ANSWER_2' },
          { status: 'success', text: 'PRIVATE_MAIN_ANSWER_3' },
          { status: 'success', text: 'PRIVATE_MAIN_ANSWER_4' },
          { status: 'success', text: 'PRIVATE_BRANCH_SUMMARY' },
          (request) => ({
            status: 'success',
            text: request.messages.map((message) => message.text).join('|'),
          }),
        ],
      },
    });
    const { sessionId } = await first.agent.resources.session.resolve({
      agentId: first.identity.id,
    });
    for (let index = 1; index <= 4; index += 1) {
      await first.run({
        message: `PRIVATE_MAIN_USER_${index}`,
        sessionId: sessionId,
      });
    }
    await first.compactSession({ sessionId: sessionId });
    const inspected = await executeSessionNavigation({
      agentId: first.identity.id,
      navigation: { sessionId: sessionId, operation: 'inspect' },
      session: firstSession,
    });
    expect(inspected).toMatchObject({
      status: 'inspected',
      navigation: { revision: 4, selectedBranchId: DEFAULT_SESSION_BRANCH_ID },
    });
    await expect(
      executeSessionNavigation({
        agentId: first.identity.id,
        navigation: {
          sessionId: sessionId,
          operation: 'rewind',
          throughTurnId: 'branch-request-2',
          newBranchId: childBranchId,
          expectedRevision: 4,
        },
        session: firstSession,
      })
    ).resolves.toEqual({
      status: 'rewound',
      sessionId: sessionId,
      selectedBranchId: childBranchId,
      affectedBranchId: childBranchId,
      revision: 5,
    });
    const childRequest = {
      message: 'PRIVATE_CHILD_USER',
      sessionId: sessionId,
      idempotencyKey: 'child-request',
    } as const;
    const childResponse = await first.run(childRequest);
    expect(childResponse.branchId).toBe(childBranchId);
    const childProviderRequest = first.inspectDeterministicProvider().requests.at(-1);
    const serializedChildRequest = JSON.stringify(childProviderRequest);
    expect(serializedChildRequest).toContain('PRIVATE_BRANCH_SUMMARY');
    expect(serializedChildRequest).toContain('PRIVATE_CHILD_USER');
    expect(serializedChildRequest).not.toContain('PRIVATE_MAIN_USER_3');
    expect(serializedChildRequest).not.toContain('PRIVATE_MAIN_ANSWER_4');

    await expect(
      executeSessionNavigation({
        agentId: first.identity.id,
        navigation: {
          sessionId: sessionId,
          operation: 'select',
          branchId: DEFAULT_SESSION_BRANCH_ID,
          expectedRevision: 6,
        },
        session: firstSession,
      })
    ).resolves.toMatchObject({
      status: 'selected',
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      revision: 7,
    });

    const reopenedSession = new SqliteSessionAdapter({
      databasePath: sessionDatabasePath,
      clock: () => 20,
    });
    const reopened = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'navigation-assistant' },
      session: reopenedSession,
      requestJournal: new SqliteRequestJournalAdapter({
        databasePath: journalDatabasePath,
        clock: () => 21,
      }),
      createRunId: () => `branch-request-${++requestSequence}`,
      provider: {
        responses: [
          (request) => ({
            status: 'success',
            text: request.messages.map((message) => message.text).join('|'),
          }),
        ],
      },
    });
    const mainResponse = await reopened.run({
      message: 'PRIVATE_MAIN_USER_5',
      sessionId: sessionId,
    });
    expect(mainResponse.branchId).toBe(DEFAULT_SESSION_BRANCH_ID);
    const serializedMainRequest = JSON.stringify(
      reopened.inspectDeterministicProvider().requests[0]
    );
    expect(serializedMainRequest).toContain('PRIVATE_BRANCH_SUMMARY');
    expect(serializedMainRequest).toContain('PRIVATE_MAIN_USER_3');
    expect(serializedMainRequest).toContain('PRIVATE_MAIN_ANSWER_4');
    expect(serializedMainRequest).not.toContain('PRIVATE_CHILD_USER');

    await expect(reopened.run(childRequest)).resolves.toEqual(childResponse);
    expect(reopened.inspectDeterministicProvider().callCount).toBe(1);
    const snapshot = await reopenedSession.inspect({
      agentId: reopened.identity.id,
      sessionId: parseSessionId(sessionId),
    });
    expect(snapshot?.navigation).toMatchObject({
      revision: 8,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      branches: [
        { branchId: DEFAULT_SESSION_BRANCH_ID, headTurnId: 'branch-request-6' },
        { branchId: childBranchId, headTurnId: 'branch-request-5' },
      ],
    });
    expect(snapshot?.turns).toHaveLength(6);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
