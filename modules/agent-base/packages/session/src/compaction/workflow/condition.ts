import { parseSessionId } from '../../identifiers.js';
import { selectSessionCompactionSource } from '../source-selection.js';
import type { SessionCompactionAgentContext, SessionCompactionCondition } from './types.js';
import { RUN_WORKFLOW, skipWorkflow } from '@ta-agent/base-workflow';

export function createShouldCompactSessionCondition(): SessionCompactionCondition {
  return async (context: SessionCompactionAgentContext) => {
    const reference = {
      agentId: context.identity.id,
      sessionId: parseSessionId(context.input.sessionId),
    };
    const [snapshot, compaction] = await Promise.all([
      context.resources.session.inspect(reference),
      context.resources.session.readCompaction(reference),
    ]);
    if (snapshot === undefined) return RUN_WORKFLOW;
    const selection = selectSessionCompactionSource(snapshot, compaction, context.resources.policy);
    return selection.status === 'selected'
      ? RUN_WORKFLOW
      : skipWorkflow('session-compaction-not-needed');
  };
}
