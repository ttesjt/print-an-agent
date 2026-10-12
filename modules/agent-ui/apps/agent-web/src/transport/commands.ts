import { workspaceCommands } from '@ta-agent/ui-transport';
import { createDefaultWorkspacePorts } from '../application/default-ports.js';
import type { AgentWebPorts } from '../application/ports.js';
import type { AgentWebConfig } from '../application/agent-config.js';
import { array, object, text, fail, type Decoder } from './decoder.js';
import * as s from './schemas.js';
import { AgentConfigValidationError } from '../application/agent-config-validation.js';

type Ports = AgentWebPorts<AgentWebConfig>;
function command<Input, Output>(
  input: Decoder<Input>,
  output: Decoder<Output>,
  invoke: (ports: Ports, input: Input, signal: AbortSignal) => Promise<Output>
) {
  return Object.freeze({
    input,
    output,
    run: async (ports: Ports, value: unknown, signal: AbortSignal) => {
      try {
        return output.decode(await invoke(ports, input.decode(value), signal));
      } catch (error) {
        if (!(error instanceof AgentConfigValidationError)) throw error;
        return output.decode({
          status: 'failed',
          failure: {
            code: 'validation-failed',
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
        });
      }
    },
  });
}
const agentId = object({ agentId: s.id });
const a = <T>(value: Decoder<T>) => s.result(value, s.agentFailure);
function shared<Input, Output>(definition: {
  readonly input: Decoder<Input>;
  readonly output: Decoder<Output>;
  readonly run: (
    ports: import('@ta-agent/ui-contracts').WorkspacePorts,
    value: unknown,
    signal: AbortSignal
  ) => Promise<Output>;
}) {
  return {
    input: definition.input,
    output: definition.output,
    run: (ports: Ports, value: unknown, signal: AbortSignal) =>
      definition.run(createDefaultWorkspacePorts(ports), value, signal),
  };
}
export const commands = Object.freeze({
  listAgentPage: shared(workspaceCommands.listAgentPage),
  inspectAgentDetails: shared(workspaceCommands.inspectAgentDetails),
  renameAgent: shared(workspaceCommands.renameAgent),
  disableAgent: shared(workspaceCommands.disableAgent),
  reactivateAgent: shared(workspaceCommands.reactivateAgent),
  listSessions: shared(workspaceCommands.listSessions),
  inspectSession: shared(workspaceCommands.inspectSession),
  inspectSessionNavigation: shared(workspaceCommands.inspectSessionNavigation),
  renameSession: shared(workspaceCommands.renameSession),
  retireSession: shared(workspaceCommands.retireSession),
  restoreSession: shared(workspaceCommands.restoreSession),
  purgeSession: shared(workspaceCommands.purgeSession),
  selectSessionBranch: shared(workspaceCommands.selectSessionBranch),
  forkSessionBranch: shared(workspaceCommands.forkSessionBranch),
  rewindSessionBranch: shared(workspaceCommands.rewindSessionBranch),
  readConversation: shared(workspaceCommands.readConversation),
  inspectModel: command(agentId, a(s.modelStatus), (p, i, signal) =>
    p.agents.inspectModel({ ...i, signal })
  ),
  testModelConnection: command(
    object({ agentId: s.id, expectedRevision: s.revision }),
    a(s.modelConnection),
    (p, i, signal) => p.agents.testModelConnection({ ...i, signal })
  ),
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
});
export type CommandName = keyof typeof commands;
export function commandName(input: unknown): CommandName {
  if (typeof input !== 'string' || !Object.hasOwn(commands, input)) return fail();
  return input as CommandName;
}
