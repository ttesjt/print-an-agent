import { parseAgentId } from '@print-an-agent/base-identity';
import { FOREGROUND_AGENT_OPERATION_NAME } from '@print-an-agent/base-composition';
import { parseTurnId, AgentSessionError } from '@print-an-agent/base-session';
import type { ConversationManagementPort } from '../../application/ports.js';
import type {
  ConversationInteractionEventConsumer,
  StartConversationInteractionInput,
  ConversationCommitReceipt,
} from '@print-an-agent/ui-contracts';
import { conversationFailure } from './failures.js';
import { completedTurn, readWebConversation, reference } from './history.js';
import type { WebBackendServices } from './profile.js';
import { projectNavigation, projectSession } from './projection.js';
import { mutateBranch } from './sessions.js';
import { WebStreamSink } from './stream-sink.js';
import {
  awaitCommittedPresentation,
  DEFAULT_PRESENTATION_WAIT_MILLISECONDS,
} from './presentation-wait.js';

export function createWebConversationManagement(
  services: WebBackendServices
): ConversationManagementPort {
  return {
    readConversation: async (input) => {
      try {
        return { status: 'succeeded', value: await readWebConversation(services, input) };
      } catch (error) {
        input.signal?.throwIfAborted();
        return { status: 'failed', failure: conversationFailure(error) };
      }
    },
    forkSessionBranch: (input) => mutateBranch(services, input, 'fork'),
    rewindSessionBranch: (input) => mutateBranch(services, input, 'rewind'),
    streamInteraction: (input, consume) => streamInteraction(services, input, consume),
  };
}

async function streamInteraction(
  services: WebBackendServices,
  input: StartConversationInteractionInput,
  consume: ConversationInteractionEventConsumer
): Promise<void> {
  input.signal?.throwIfAborted();
  await consume({ type: 'interaction-started', interactionId: input.interactionId });
  const sink = new WebStreamSink(input, consume, services.toolLabels, async (target) => {
    const sessionReference = reference(target);
    const [details, navigation] = await Promise.all([
      services.sessions.inspect(sessionReference),
      services.navigation.inspect(sessionReference),
    ]);
    if (details === undefined) throw new Error('Admitted Session is unavailable.');
    return {
      details: projectSession(details),
      navigation: projectNavigation(navigation.navigation),
    };
  });
  let terminalAccepted = false;
  let committed: ConversationCommitReceipt | undefined;
  try {
    const agent = await services.runtime.open(parseAgentId(input.agentId));
    input.signal?.throwIfAborted();
    const response = await agent.invoke(
      FOREGROUND_AGENT_OPERATION_NAME,
      {
        message: input.message,
        ...(input.session === undefined
          ? {}
          : { sessionId: input.session.sessionId, idempotencyKey: input.interactionId }),
        outputSink: sink,
      },
      input.signal === undefined ? {} : { signal: input.signal }
    );
    const target = reference({ agentId: input.agentId, sessionId: response.sessionId });
    if (
      input.session !== undefined &&
      (response.sessionId !== input.session.sessionId ||
        response.branchId !== input.session.branchId)
    )
      throw new AgentSessionError(
        'SESSION_NAVIGATION_CONFLICT',
        'Response belongs to a different conversation target.'
      );
    // This app owns the standard beginRequest composition: Turn ID = Run ID.
    // The journal replays the original response.requestId, not the replay Run ID.
    // Successful invoke establishes commit authority before any optional display reads.
    const turnId = sink.turnId ?? parseTurnId(response.requestId);
    committed = {
      sessionId: response.sessionId,
      branchId: response.branchId,
      turnId,
    };
    const projected = await awaitCommittedPresentation(async () => {
      const session = await services.sessionFor(target.agentId);
      const snapshot = await session.inspect(target);
      const actual = snapshot?.turns.find((record) => record.turnId === turnId);
      if (actual?.status !== 'completed' || actual.branchId !== response.branchId)
        throw new Error('Committed Turn is unavailable.');
      return completedTurn(services, target, actual, response.branchId, [...sink.tools.values()]);
    }, services.modelHost.presentationWaitMilliseconds ?? DEFAULT_PRESENTATION_WAIT_MILLISECONDS);
    if (sink.turnId === undefined) {
      // Replay has no model loop. Reconstruct its saved display events, not model evidence.
      for (const block of projected.assistantMessage.reasoningBlocks) {
        input.signal?.throwIfAborted();
        await consume({
          type: 'reasoning-delta',
          interactionId: input.interactionId,
          modelTurnIndex: block.modelTurnIndex,
          delta: block.text,
        });
      }
      for (const event of sink.replayOutput) {
        input.signal?.throwIfAborted();
        await consume({
          ...event,
          interactionId: input.interactionId,
          modelTurnIndex: projected.assistantMessage.reasoningBlocks.at(-1)?.modelTurnIndex ?? 1,
        });
      }
    }
    input.signal?.throwIfAborted();
    terminalAccepted = true;
    await consume({
      type: 'completed',
      interactionId: input.interactionId,
      sessionId: response.sessionId,
      turn: projected,
    });
  } catch (error) {
    if (terminalAccepted) throw error;
    if (committed !== undefined) {
      await consume({
        type: 'committed',
        interactionId: input.interactionId,
        receipt: committed,
        message:
          'The response was saved, but its presentation could not be loaded. Reload the saved response.',
      });
      return;
    }
    await consume(
      input.signal?.aborted
        ? { type: 'cancelled', interactionId: input.interactionId }
        : {
            type: 'failed',
            interactionId: input.interactionId,
            failure: conversationFailure(error),
          }
    );
  }
}
