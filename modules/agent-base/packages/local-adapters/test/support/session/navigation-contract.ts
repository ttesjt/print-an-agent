import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseTurnId,
} from '@print-an-agent/base-session';
import { expect, it } from 'vitest';
import { withHarness } from './harness.js';
import { assistantMessage, userMessage } from './messages.js';
import type { SessionPortContractHarness } from './types.js';
import { sessionWrite } from './write.js';

export function defineSessionNavigationContract(
  createHarness: () => SessionPortContractHarness
): void {
  it('creates one default branch and rejects stale or concurrent request authority', () =>
    withHarness(createHarness, async (adapter) => {
      const identity = defineAgentIdentity({ id: 'navigation-authority-agent' });
      const initial = await adapter.resolve({
        agentId: identity.id,
      });
      expect(initial).toMatchObject({
        branchId: DEFAULT_SESSION_BRANCH_ID,
        navigationRevision: 0,
      });
      const firstTurnId = parseTurnId('first-active');
      await sessionWrite(
        adapter,
        {
          ...initial,
          turnId: firstTurnId,
          userMessage: userMessage('first', 1),
        },
        (input) => adapter.beginTurn(input)
      );
      await expect(
        sessionWrite(
          adapter,
          {
            ...initial,
            turnId: parseTurnId('second-active'),
            userMessage: userMessage('second', 2),
          },
          (input) => adapter.beginTurn(input)
        )
      ).rejects.toMatchObject({ code: 'SESSION_BRANCH_BUSY' });
      await sessionWrite(
        adapter,
        {
          ...initial,
          turnId: firstTurnId,
          assistantMessage: assistantMessage('done', 3),
        },
        (input) => adapter.completeTurn(input)
      );
      await expect(
        sessionWrite(
          adapter,
          {
            ...initial,
            turnId: parseTurnId('stale'),
            userMessage: userMessage('stale', 4),
          },
          (input) => adapter.beginTurn(input)
        )
      ).rejects.toMatchObject({ code: 'SESSION_NAVIGATION_CONFLICT' });

      const snapshot = await adapter.inspect(initial);
      expect(snapshot?.navigation).toMatchObject({
        revision: 1,
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        branches: [{ branchId: DEFAULT_SESSION_BRANCH_ID, headTurnId: firstTurnId }],
      });
      expect(Object.isFrozen(snapshot?.navigation.branches)).toBe(true);
    }));

  it('forks, selects, and rewinds without moving or rewriting source history', () =>
    withHarness(createHarness, async (adapter) => {
      const identity = defineAgentIdentity({ id: 'navigation-agent' });
      const { sessionId } = await adapter.resolve({ agentId: identity.id });
      const mainTurns = [
        parseTurnId('main-one'),
        parseTurnId('main-two'),
        parseTurnId('main-three'),
      ];
      for (const [index, turnId] of mainTurns.entries()) {
        const current = await adapter.resolve({
          agentId: identity.id,
          sessionId: sessionId,
        });
        await sessionWrite(
          adapter,
          {
            ...current,
            turnId,
            userMessage: userMessage(`main-user-${index}`, index * 2 + 1),
          },
          (input) => adapter.beginTurn(input)
        );
        await sessionWrite(
          adapter,
          {
            ...current,
            turnId,
            assistantMessage: assistantMessage(`main-assistant-${index}`, index * 2 + 2),
          },
          (input) => adapter.completeTurn(input)
        );
      }
      const reference = await adapter.resolve({
        agentId: identity.id,
        sessionId: sessionId,
      });
      const childBranchId = parseSessionBranchId('child');
      const forked = await sessionWrite(
        adapter,
        {
          ...reference,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: mainTurns[0]!,
            newBranchId: childBranchId,
            expectedRevision: reference.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      expect(forked).toMatchObject({
        operation: 'fork',
        affectedBranchId: childBranchId,
        navigation: { selectedBranchId: DEFAULT_SESSION_BRANCH_ID, revision: 4 },
      });
      const selected = await sessionWrite(
        adapter,
        {
          ...reference,
          command: {
            operation: 'select',
            branchId: childBranchId,
            expectedRevision: 4,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      expect(selected.navigation).toMatchObject({ selectedBranchId: childBranchId, revision: 5 });

      const child = await adapter.resolve({
        agentId: identity.id,
        sessionId: sessionId,
      });
      const childTurnId = parseTurnId('child-turn');
      await sessionWrite(
        adapter,
        {
          ...child,
          turnId: childTurnId,
          userMessage: userMessage('child-user', 10),
        },
        (input) => adapter.beginTurn(input)
      );
      expect(await adapter.loadHistory({ ...child, beforeTurnId: childTurnId })).toEqual([
        userMessage('main-user-0', 1),
        assistantMessage('main-assistant-0', 2),
      ]);
      await sessionWrite(
        adapter,
        {
          ...child,
          turnId: childTurnId,
          assistantMessage: assistantMessage('child-assistant', 11),
        },
        (input) => adapter.completeTurn(input)
      );

      const beforeRewind = await adapter.resolve({
        agentId: identity.id,
        sessionId: sessionId,
      });
      const rewindBranchId = parseSessionBranchId('rewound');
      const rewound = await sessionWrite(
        adapter,
        {
          ...beforeRewind,
          command: {
            operation: 'rewind',
            throughTurnId: mainTurns[0]!,
            newBranchId: rewindBranchId,
            expectedRevision: beforeRewind.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      expect(rewound.navigation).toMatchObject({
        selectedBranchId: rewindBranchId,
        revision: 7,
      });
      const snapshot = await adapter.inspect(reference);
      expect(snapshot?.navigation.branches).toMatchObject([
        { branchId: DEFAULT_SESSION_BRANCH_ID, headTurnId: mainTurns[2] },
        { branchId: childBranchId, headTurnId: childTurnId },
        { branchId: rewindBranchId, headTurnId: mainTurns[0] },
      ]);
      expect(snapshot?.turns).toHaveLength(4);
    }));

  it('inherits only a compaction projection safe for the new branch point', () =>
    withHarness(createHarness, async (adapter) => {
      const identity = defineAgentIdentity({ id: 'navigation-compaction-agent' });
      const { sessionId } = await adapter.resolve({ agentId: identity.id });
      const turnIds = [parseTurnId('one'), parseTurnId('two'), parseTurnId('three')];
      for (const [index, turnId] of turnIds.entries()) {
        const current = await adapter.resolve({
          agentId: identity.id,
          sessionId: sessionId,
        });
        await sessionWrite(
          adapter,
          {
            ...current,
            turnId,
            userMessage: userMessage(`u${index}`, index * 2 + 1),
          },
          (input) => adapter.beginTurn(input)
        );
        await sessionWrite(
          adapter,
          {
            ...current,
            turnId,
            assistantMessage: assistantMessage(`a${index}`, index * 2 + 2),
          },
          (input) => adapter.completeTurn(input)
        );
      }
      const main = await adapter.resolve({
        agentId: identity.id,
        sessionId: sessionId,
      });
      await sessionWrite(
        adapter,
        {
          ...main,
          expectedRevision: 0,
          throughTurnId: turnIds[1]!,
          context: { role: 'context', text: 'main summary', timestamp: 20 },
        },
        (input) => adapter.commitCompaction(input)
      );
      const safeBranchId = parseSessionBranchId('safe');
      await sessionWrite(
        adapter,
        {
          ...main,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: turnIds[2]!,
            newBranchId: safeBranchId,
            expectedRevision: main.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      expect(await adapter.readCompaction({ ...main, branchId: safeBranchId })).toMatchObject({
        branchId: safeBranchId,
        revision: 1,
        throughTurnId: turnIds[1],
        context: { text: 'main summary' },
      });

      const afterSafe = await adapter.resolve({
        agentId: identity.id,
        sessionId: sessionId,
      });
      const unsafeBranchId = parseSessionBranchId('unsafe');
      await sessionWrite(
        adapter,
        {
          ...afterSafe,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: turnIds[0]!,
            newBranchId: unsafeBranchId,
            expectedRevision: afterSafe.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      expect(
        await adapter.readCompaction({ ...afterSafe, branchId: unsafeBranchId })
      ).toBeUndefined();
    }));
}
