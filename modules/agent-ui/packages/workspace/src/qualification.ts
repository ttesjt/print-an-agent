import type {
  AgentDetails,
  StartConversationInteractionInput,
  WorkspacePorts,
} from '@print-an-agent/ui-contracts';
import {
  createSubmittingInteraction,
  type ActiveInteractionState,
} from './conversation/interaction-state.js';
import { executeConversationInteraction } from './conversation/execute-conversation-interaction.js';

/** Read-only qualification of real pagination and independently inspectable identities. */
export async function qualifyWorkspaceCatalog(
  ports: WorkspacePorts,
  options: { readonly signal?: AbortSignal; readonly maxPages?: number } = {}
): Promise<readonly AgentDetails[]> {
  const limit = options.maxPages ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Invalid qualification page limit.');
  const records: AgentDetails[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < limit; page++) {
    options.signal?.throwIfAborted();
    const input = {
      ...(cursor === undefined ? {} : { cursor }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    const result = await ports.agents.listAgentPage(input);
    if (result.status !== 'succeeded')
      throw new Error('Catalog qualification could not read a page.');
    for (const summary of result.value.records) {
      if (identities.has(summary.agentId))
        throw new Error('Catalog qualification found a duplicate identity.');
      identities.add(summary.agentId);
      const inspected = await ports.agents.inspectAgentDetails({
        agentId: summary.agentId,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (inspected.status !== 'succeeded' || inspected.value.agentId !== summary.agentId)
        throw new Error('Catalog inspection did not preserve identity.');
      records.push(inspected.value);
    }
    cursor = result.value.nextCursor;
    if (cursor === undefined) return records;
    if (cursors.has(cursor)) throw new Error('Catalog qualification found a repeated cursor.');
    cursors.add(cursor);
  }
  throw new Error('Catalog qualification exceeded its page limit.');
}

/** Executes a real interaction: use disposable fixture resources. No retry or backend mutation is hidden. */
export async function qualifyWorkspaceInteraction(
  ports: WorkspacePorts,
  request: StartConversationInteractionInput
): Promise<Extract<ActiveInteractionState, { readonly status: 'completed' | 'committed' }>> {
  const result = await executeConversationInteraction({
    management: ports.conversations,
    request,
    initial: createSubmittingInteraction({
      interactionId: request.interactionId,
      message: request.message,
      timestamp: new Date().toISOString(),
    }),
    isCurrent: () => true,
    onAdmission: () => {},
    onProgress: () => {},
  });
  if (result?.status !== 'completed' && result?.status !== 'committed')
    throw new Error('Interaction qualification requires a valid settled durable outcome.');
  return result;
}
