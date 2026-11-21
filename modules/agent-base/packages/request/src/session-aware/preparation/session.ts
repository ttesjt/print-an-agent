import { parseTurnId, supportsSessionExecution } from '@print-an-agent/base-session';
import { requireValue } from '../../state-access.js';
import { traceSessionResolved } from '../tracing.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export async function resolveSession(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  context.state.session = await context.resources.session.resolve({
    agentId: context.state.agentId,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
  });
  if (supportsSessionExecution(context.resources.session)) {
    const execution = await context.resources.session.acquireSessionExecution(
      context.state.session
    );
    context.state.session = Object.freeze({ ...context.state.session, execution });
  }
  await traceSessionResolved(context);
}

export async function beginRequest(context: DefaultRequestWorkflowContext): Promise<void> {
  const request = requireValue(context.state.request, 'request');
  const session = requireValue(context.state.session, 'session');
  const userMessage = Object.freeze({
    role: 'user' as const,
    text: request.message,
    timestamp: context.resources.clock(),
  });
  context.state.userMessage = userMessage;
  context.state.turn = await context.resources.session.beginTurn({
    ...session,
    turnId: parseTurnId(context.state.requestId),
    userMessage,
  });
}
