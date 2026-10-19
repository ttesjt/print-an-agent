import { parseSessionBranchId, parseSessionId } from '../../identifiers.js';
import { selectSessionCompactionSource } from '../source-selection.js';
import { resolveSessionCompactionTarget } from '../planning/target.js';
import { AgentSessionError } from '../../errors.js';
import type { SessionCompactionCondition } from './types.js';
import { RUN_WORKFLOW, skipWorkflow } from '@ta-agent/workflow-core';

export function createShouldCompactSessionCondition(): SessionCompactionCondition {
  return async ({ input: context, resources }) => {
    const target = resolveSessionCompactionTarget(
      resources.policy.maxContextTokens,
      resources.policy.target,
      context.input.target
    );
    if (target < resources.policy.minimumTargetTokens) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_INVALID',
        'Target is below the minimum planner target.'
      );
    }
    const reference = {
      agentId: context.identity.id,
      sessionId: parseSessionId(context.input.sessionId),
    };
    const snapshot = await resources.session.inspect(reference);
    if (snapshot === undefined) return RUN_WORKFLOW;
    const branchId =
      context.input.branchId === undefined
        ? snapshot.navigation.selectedBranchId
        : parseSessionBranchId(context.input.branchId);
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
