import { parseSessionBranchId, parseSessionId } from '../../../contracts/index.js';
import { AgentSessionError } from '../../../errors.js';
import { supportsSessionExecution } from '../../../lifecycle/index.js';
import type { SessionCompactionWorkflowContext } from '../types.js';

export async function inspectSession(context: SessionCompactionWorkflowContext): Promise<void> {
  const reference = {
    agentId: context.state.agentId,
    sessionId: parseSessionId(context.state.compactionInput.sessionId),
  };
  if (supportsSessionExecution(context.resources.session)) {
    context.state.execution = await context.resources.session.acquireSessionExecution(reference);
  }
  const snapshot = await context.resources.session.inspect(reference);
  if (snapshot === undefined)
    throw new AgentSessionError('SESSION_NOT_FOUND', 'Compaction Session does not exist.');
  const branchId =
    context.state.compactionInput.branchId === undefined
      ? snapshot.navigation.selectedBranchId
      : parseSessionBranchId(context.state.compactionInput.branchId);
  const compaction = await context.resources.session.readCompaction({ ...reference, branchId });
  context.state.snapshot = snapshot;
  context.state.branchId = branchId;
  if (compaction !== undefined) context.state.previousCompaction = compaction;
}
