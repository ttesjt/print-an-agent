import { FOREGROUND_INTERACTION_RESPONSIBILITY_ID } from '@print-an-agent/agent-actor';
import { defineToolPermissionPolicy } from '@print-an-agent/base-tool';
import { buildRequestTools } from '../../preparation/index.js';
import { requireValue } from '../../state-access.js';
import { traceActorResolved, traceToolsResolved } from '../tracing.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export async function resolveExecutionTarget(
  context: DefaultRequestWorkflowContext
): Promise<void> {
  context.state.responsibility = await context.resources.responsibilities.resolve(
    FOREGROUND_INTERACTION_RESPONSIBILITY_ID
  );
  await traceActorResolved(context);
}

export async function buildTools(context: DefaultRequestWorkflowContext): Promise<void> {
  const responsibility = requireValue(context.state.responsibility, 'responsibility');
  context.state.toolPermissionPolicy = defineToolPermissionPolicy({
    responsibility: responsibility.allowedTools,
    actor: responsibility.actor.allowedTools,
    product: context.resources.productToolAllowList,
    runtime: context.resources.runtimeToolAllowList,
  });
  await buildRequestTools(context);
  await traceToolsResolved(context);
}
