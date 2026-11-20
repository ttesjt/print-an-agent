import { AgentSessionError } from '../../../../errors.js';
import { measureSessionCompactionText } from '../../../token-measurement.js';
import { requireCompactionState } from '../../state-access.js';
import type { SessionCompactionWorkflowContext } from '../../types.js';

export async function measureCompactionCandidate(
  context: SessionCompactionWorkflowContext
): Promise<void> {
  if (context.state.assessment !== undefined) return;
  const candidate = requireCompactionState(context, 'candidate');
  // Truncated/empty text is not a complete draft and needs no token work.
  if (candidate.stopReason === 'length' || candidate.text.trim().length === 0) return;
  if (candidate.stopReason !== 'stop')
    throw new AgentSessionError(
      'SESSION_COMPACTION_OUTPUT_INVALID',
      'Candidate did not finish with a successful generation stop.'
    );
  context.state.candidateTokens = await measureSessionCompactionText(
    candidate.text,
    requireCompactionState(context, 'tokenCounter'),
    context.signal
  );
}
