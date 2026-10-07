import type { AgentWebPorts } from '../application/ports.js';
import type { DemoAgentConfig } from '../application/demo-agent-config.js';
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

type Ports = AgentWebPorts<DemoAgentConfig>;
function command<Input, Output>(
  input: Decoder<Input>,
  output: Decoder<Output>,
  invoke: (ports: Ports, input: Input, signal: AbortSignal) => Promise<Output>
) {
  return Object.freeze({
    input,
    output,
    run: async (ports: Ports, value: unknown, signal: AbortSignal) =>
      output.decode(await invoke(ports, input.decode(value), signal)),
  });
}
const agentId = object({ agentId: s.id });
const target = { agentId: s.id, sessionId: s.id };
const lifecycle = object({ ...target, expectedRevision: s.revision });
const unit: Decoder<void> = {
  decode: (input) => (input === null || input === undefined ? undefined : fail()),
};
const a = <T>(value: Decoder<T>) => s.result(value, s.agentFailure);
const m = <T>(value: Decoder<T>) => s.result(value, s.sessionFailure);

/** Closed application RPC vocabulary; schemas are the same on both sides of transport. */
export const commands = Object.freeze({
  listAgents: command(object({}), a(array(s.agentSummary)), (p, i, signal) =>
    p.agents.listAgents({ ...i, signal })
  ),
  inspectAgent: command(agentId, a(s.agentSnapshot), (p, i, signal) =>
    p.agents.inspectAgent({ ...i, signal })
  ),
  readAgentConfig: command(agentId, a(s.configSnapshot), (p, i, signal) =>
    p.agents.readAgentConfig({ ...i, signal })
  ),
  createAgent: command(
    object({ identity: object({ agentId: s.id, displayName: text(256, 1) }), config: s.config }),
    a(s.agentSnapshot),
    (p, i, signal) => p.agents.createAgent({ ...i, signal })
  ),
  updateAgentConfig: command(
    object({ agentId: s.id, expectedRevision: s.revision, config: s.config }),
    a(s.configSnapshot),
    (p, i, signal) => p.agents.updateAgentConfig({ ...i, signal })
  ),
  disableAgent: command(
    object({ agentId: s.id, expectedRevision: s.revision }),
    a(s.agentDetails),
    (p, i, signal) => p.agents.disableAgent({ ...i, signal })
  ),
  reactivateAgent: command(
    object({ agentId: s.id, expectedRevision: s.revision }),
    a(s.agentDetails),
    (p, i, signal) => p.agents.reactivateAgent({ ...i, signal })
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
    (p, i, signal) => p.sessions.renameSession({ ...i, signal })
  ),
  retireSession: command(lifecycle, m(s.session), (p, i, signal) =>
    p.sessions.retireSession({ ...i, signal })
  ),
  restoreSession: command(lifecycle, m(s.session), (p, i, signal) =>
    p.sessions.restoreSession({ ...i, signal })
  ),
  purgeSession: command(
    object({
      ...target,
      expectedRevision: s.revision,
      confirmation: literal('permanently-delete-session'),
    }),
    m(unit),
    (p, i, signal) => p.sessions.purgeSession({ ...i, signal })
  ),
  selectSessionBranch: command(
    object({ ...target, branchId: s.id, expectedRevision: s.revision }),
    m(s.navigation),
    (p, i, signal) => p.sessions.selectSessionBranch({ ...i, signal })
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
    (p, i, signal) => p.conversations.forkSessionBranch({ ...i, signal })
  ),
  rewindSessionBranch: command(
    object({
      ...target,
      throughTurnId: s.id,
      expectedRevision: s.revision,
      newBranchId: optional(s.id),
    }),
    m(s.branchMutation),
    (p, i, signal) => p.conversations.rewindSessionBranch({ ...i, signal })
  ),
  readConversation: command(
    object({ ...target, branchId: s.id, limit: optional(integer(1, 200)), cursor: optional(s.id) }),
    s.result(s.conversationPage, s.conversationFailure),
    (p, i, signal) => p.conversations.readConversation({ ...i, signal })
  ),
});
export type CommandName = keyof typeof commands;
export function commandName(input: unknown): CommandName {
  if (typeof input !== 'string' || !Object.hasOwn(commands, input)) return fail();
  return input as CommandName;
}
