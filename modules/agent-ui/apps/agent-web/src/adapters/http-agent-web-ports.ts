import { createHttpTransport } from '@ta-agent/ui-transport/browser';
import type { AgentWebPorts } from '../application/ports.js';
import type { AgentWebConfig } from '../application/agent-config.js';
import { commands, type CommandName } from '../transport/commands.js';
import { TransportProtocolError, type Decoder } from '../transport/decoder.js';
import { AgentConfigValidationError } from '../application/agent-config-validation.js';

export interface HttpAgentWebOptions {
  /** Relative same-origin URL in browsers; an absolute URL is useful for Node qualification. */
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function createHttpAgentWebPorts(
  options: HttpAgentWebOptions = {}
): AgentWebPorts<AgentWebConfig> {
  const transport = createHttpTransport(options);
  const rpc = async <T>(
    name: CommandName,
    input: { readonly signal?: AbortSignal },
    output: Decoder<T>
  ): Promise<T> => {
    const { signal } = input;
    signal?.throwIfAborted();
    try {
      return await transport.command(name, input, commands[name].input, output);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof AgentConfigValidationError)
        return output.decode({
          status: 'failed',
          failure: {
            code: 'validation-failed',
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
        });
      return output.decode({
        status: 'failed',
        failure: {
          code:
            error instanceof TransportProtocolError || error instanceof SyntaxError
              ? 'operation-failed'
              : 'unavailable',
          message:
            'The local host is unavailable or returned an invalid response. Start the host and retry.',
        },
      });
    }
  };
  return {
    agents: {
      renameAgent: (input) => rpc('renameAgent', input, commands.renameAgent.output),
      inspectModel: (i) => rpc('inspectModel', i, commands.inspectModel.output),
      testModelConnection: (i) =>
        rpc('testModelConnection', i, commands.testModelConnection.output),
      listAgents: (i = {}) => rpc('listAgents', i, commands.listAgents.output),
      inspectAgent: (i) => rpc('inspectAgent', i, commands.inspectAgent.output),
      readAgentConfig: (i) => rpc('readAgentConfig', i, commands.readAgentConfig.output),
      createAgent: (i) => rpc('createAgent', i, commands.createAgent.output),
      updateAgentConfig: (i) => rpc('updateAgentConfig', i, commands.updateAgentConfig.output),
      disableAgent: (i) => rpc('disableAgent', i, commands.disableAgent.output),
      reactivateAgent: (i) => rpc('reactivateAgent', i, commands.reactivateAgent.output),
    },
    sessions: {
      listSessions: (i) => rpc('listSessions', i, commands.listSessions.output),
      inspectSession: (i) => rpc('inspectSession', i, commands.inspectSession.output),
      inspectSessionNavigation: (i) =>
        rpc('inspectSessionNavigation', i, commands.inspectSessionNavigation.output),
      renameSession: (i) => rpc('renameSession', i, commands.renameSession.output),
      retireSession: (i) => rpc('retireSession', i, commands.retireSession.output),
      restoreSession: (i) => rpc('restoreSession', i, commands.restoreSession.output),
      purgeSession: (i) => rpc('purgeSession', i, commands.purgeSession.output),
      selectSessionBranch: (i) =>
        rpc('selectSessionBranch', i, commands.selectSessionBranch.output),
    },
    conversations: {
      readConversation: (i) => rpc('readConversation', i, commands.readConversation.output),
      forkSessionBranch: (i) => rpc('forkSessionBranch', i, commands.forkSessionBranch.output),
      rewindSessionBranch: (i) =>
        rpc('rewindSessionBranch', i, commands.rewindSessionBranch.output),
      streamInteraction: transport.streamInteraction,
    },
  };
}
