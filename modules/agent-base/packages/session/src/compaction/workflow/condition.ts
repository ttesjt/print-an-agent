import { parseSessionBranchId, parseSessionId } from '../../identifiers.js';
import { selectSessionCompactionSource } from '../source-selection.js';
import { resolveSessionCompactionTarget } from '../planning/target.js';
import { AgentSessionError } from '../../errors.js';
import { defineCompactSessionInput } from '../input.js';
import type { SessionCompactionCondition } from './types.js';
import { RUN_WORKFLOW, skipWorkflow } from '@print-an-agent/workflow-core';

export function createShouldCompactSessionCondition(): SessionCompactionCondition {
  return async ({ input, resources }) => {
    const compactionInput = defineCompactSessionInput(input.compactionInput);
    const target = resolveSessionCompactionTarget(
      resources.policy.maxContextTokens,
      resources.policy.target,
      compactionInput.target
    );
    if (target < resources.policy.minimumTargetTokens) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_INVALID',
        'Target is below the minimum planner target.'
      );
    }
    const reference = {
      agentId: input.agentId,
      sessionId: parseSessionId(compactionInput.sessionId),
    };
    const snapshot = await resources.session.inspect(reference);
    if (snapshot === undefined) return RUN_WORKFLOW;
    const branchId =
      compactionInput.branchId === undefined
        ? snapshot.navigation.selectedBranchId
        : parseSessionBranchId(compactionInput.branchId);
    const compaction = await resources.session.readCompaction({ ...reference, branchId });
    const selection = selectSessionCompactionSource(
      snapshot,
      branchId,
      compaction,
      resources.policy
    );
    return selection.status === 'selected'
      ? RUN_WORKFLOW
      : skipWorkflow('session-compaction-not-needed');
  };
}
