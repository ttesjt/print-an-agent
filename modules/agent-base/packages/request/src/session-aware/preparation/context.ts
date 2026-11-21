import { requireValue } from '../../state-access.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export async function loadSessionContext(context: DefaultRequestWorkflowContext): Promise<void> {
  const session = requireValue(context.state.session, 'session');
  const turn = requireValue(context.state.turn, 'turn');
  const snapshot = await context.resources.session.loadContext({
    ...session,
    beforeTurnId: turn.turnId,
  });
  context.state.history = snapshot.messages;
}

export async function loadContextMemory(context: DefaultRequestWorkflowContext): Promise<void> {
  const capability = context.resources.contextMemory;
  if (capability === undefined) return;
  const memory = await capability.open(
    {
      session: requireValue(context.state.session, 'session'),
      turn: requireValue(context.state.turn, 'turn'),
      requestId: context.state.requestId,
    },
    context.signal
  );
  context.state.contextMemory = memory;
  context.state.history = Object.freeze([
    { role: 'context' as const, text: memory.text, timestamp: context.resources.clock() },
    ...requireValue(context.state.history, 'history'),
  ]);
}
