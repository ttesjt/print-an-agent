import type { WorkspacePorts } from '@ta-agent/ui-contracts';
import {
  array,
  integer,
  literal,
  object,
  optional,
  text,
  union,
  fail,
  type Decoder,
} from './decoder.js';
import * as s from './schemas.js';
function command<Input, Output>(
  input: Decoder<Input>,
  output: Decoder<Output>,
  invoke: (ports: WorkspacePorts, input: Input, signal: AbortSignal) => Promise<Output>
) {
  return Object.freeze({
    input,
    output,
    run: async (ports: WorkspacePorts, value: unknown, signal: AbortSignal) =>
      output.decode(await invoke(ports, input.decode(value), signal)),
  });
}
function required<T>(capability: T | undefined): T {
  if (capability === undefined) return fail();
  return capability;
}
const agentId = object({ agentId: s.id });
const target = { agentId: s.id, sessionId: s.id };
const lifecycle = object({ ...target, expectedRevision: s.revision });
const unit: Decoder<void> = {
  decode: (input) => (input === null || input === undefined ? undefined : fail()),
};
const a = <T>(value: Decoder<T>) => s.result(value, s.agentFailure);
const m = <T>(value: Decoder<T>) => s.result(value, s.sessionFailure);

export const workspaceCommands = Object.freeze({
  listAgentPage: command(
    object({ cursor: optional(text(2048, 1)), limit: optional(integer(1, 200)) }),
    a(object({ records: array(s.agentSummary), nextCursor: optional(text(2048, 1)) })),
    (p, i, signal) => p.agents.listAgentPage({ ...i, signal })
  ),
  inspectAgentDetails: command(agentId, a(s.agentDetails), (p, i, signal) =>
    p.agents.inspectAgentDetails({ ...i, signal })
  ),
  renameAgent: command(
    object({ agentId: s.id, displayName: text(256, 1), expectedRevision: s.revision }),
    a(s.agentDetails),
    (p, i, signal) => required(p.agents.renameAgent?.({ ...i, signal }))
  ),
  disableAgent: command(
    object({ agentId: s.id, expectedRevision: s.revision }),
    a(s.agentDetails),
    (p, i, signal) => required(p.agents.disableAgent?.({ ...i, signal }))
  ),
  reactivateAgent: command(
    object({ agentId: s.id, expectedRevision: s.revision }),
    a(s.agentDetails),
    (p, i, signal) => required(p.agents.reactivateAgent?.({ ...i, signal }))
  ),
  listSessions: command(
    object({
      agentId: s.id,
      status: union(literal('active'), literal('retired')),
      limit: optional(integer(1, 200)),
      cursor: optional(text(2048, 1)),
    }),
    m(s.sessionPage),
    (p, i, signal) => p.sessions.listSessions({ ...i, signal })
  ),
  inspectSession: command(object(target), m(s.session), (p, i, signal) =>
    p.sessions.inspectSession({ ...i, signal })
  ),
  inspectSessionNavigation: command(object(target), m(s.navigation), (p, i, signal) =>
    p.sessions.inspectSessionNavigation({ ...i, signal })
  ),
  renameSession: command(
    object({ ...target, expectedRevision: s.revision, title: text(256, 1) }),
    m(s.session),
    (p, i, signal) => required(p.sessions.renameSession?.({ ...i, signal }))
  ),
  retireSession: command(lifecycle, m(s.session), (p, i, signal) =>
    required(p.sessions.retireSession?.({ ...i, signal }))
  ),
  restoreSession: command(lifecycle, m(s.session), (p, i, signal) =>
    required(p.sessions.restoreSession?.({ ...i, signal }))
  ),
  purgeSession: command(
    object({
      ...target,
      expectedRevision: s.revision,
      confirmation: literal('permanently-delete-session'),
    }),
    m(unit),
    (p, i, signal) => required(p.sessions.purgeSession?.({ ...i, signal }))
  ),
  selectSessionBranch: command(
    object({ ...target, branchId: s.id, expectedRevision: s.revision }),
    m(s.navigation),
    (p, i, signal) => required(p.sessions.selectSessionBranch?.({ ...i, signal }))
  ),
  forkSessionBranch: command(
    object({
      ...target,
      sourceBranchId: s.id,
      throughTurnId: s.id,
      expectedRevision: s.revision,
      newBranchId: optional(s.id),
    }),
    m(s.branchMutation),
    (p, i, signal) => required(p.conversations.forkSessionBranch?.({ ...i, signal }))
  ),
  rewindSessionBranch: command(
    object({
      ...target,
      throughTurnId: s.id,
      expectedRevision: s.revision,
      newBranchId: optional(s.id),
    }),
    m(s.branchMutation),
    (p, i, signal) => required(p.conversations.rewindSessionBranch?.({ ...i, signal }))
  ),
  readConversation: command(
    object({ ...target, branchId: s.id, limit: optional(integer(1, 200)), cursor: optional(s.id) }),
    s.result(s.conversationPage, s.conversationFailure),
    (p, i, signal) => p.conversations.readConversation({ ...i, signal })
  ),
});
export type WorkspaceCommandName = keyof typeof workspaceCommands;
export function workspaceCommandName(input: unknown): WorkspaceCommandName {
  if (typeof input !== 'string' || !Object.hasOwn(workspaceCommands, input)) return fail();
  return input as WorkspaceCommandName;
}
