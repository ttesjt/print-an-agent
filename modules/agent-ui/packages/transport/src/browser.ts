import type {
  ConversationInteractionEvent,
  ConversationInteractionEventConsumer,
  StartConversationInteractionInput,
  WorkspacePorts,
} from '@ta-agent/ui-contracts';
import { fail, TransportProtocolError, type Decoder } from './decoder.js';
import { WEB_TRANSPORT_LIMITS } from './limits.js';
import { interactionEvent, interactionInput } from './schemas.js';
import { workspaceCommands } from './commands.js';
import type { WorkspaceTransportCapabilities } from './capabilities.js';
import { readNdjsonResponse } from './ndjson.js';
export { readNdjsonResponse } from './ndjson.js';
export interface HttpTransportOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}
/** Host/application retains authentication, routing and resource ownership. */
export function createHttpTransport(options: HttpTransportOptions = {}) {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? '/api').replace(/\/$/u, '');
  return {
    command: async <T>(
      name: string,
      input: { readonly signal?: AbortSignal },
      inputDecoder: Decoder<unknown>,
      output: Decoder<T>
    ): Promise<T> => {
      const { signal, ...payload } = input;
      signal?.throwIfAborted();
      const response = await fetch(baseUrl + '/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: name, input: inputDecoder.decode(payload) }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json'))
        return fail();
      return output.decode(
        JSON.parse(await readResponseBody(response, WEB_TRANSPORT_LIMITS.responseBytes))
      );
    },
    streamInteraction: (
      input: StartConversationInteractionInput,
      consume: ConversationInteractionEventConsumer
    ) => stream(fetch, baseUrl + '/interactions', input, consume),
  };
}

export function createHttpWorkspacePorts(
  options: HttpTransportOptions & { readonly capabilities?: WorkspaceTransportCapabilities } = {}
): WorkspacePorts {
  const transport = createHttpTransport(options);
  const c = options.capabilities ?? {};
  const invoke = async <T>(
    name: keyof typeof workspaceCommands,
    input: { readonly signal?: AbortSignal },
    output: Decoder<T>
  ): Promise<T> => {
    try {
      return await transport.command(name, input, workspaceCommands[name].input, output);
    } catch (error) {
      input.signal?.throwIfAborted();
      return output.decode({
        status: 'failed',
        failure: {
          code:
            error instanceof TransportProtocolError || error instanceof SyntaxError
              ? 'operation-failed'
              : 'unavailable',
          message: 'The host is unavailable or returned an invalid response.',
        },
      });
    }
  };
  return {
    agents: {
      listAgentPage: (i) => invoke('listAgentPage', i, workspaceCommands.listAgentPage.output),
      inspectAgentDetails: (i) =>
        invoke('inspectAgentDetails', i, workspaceCommands.inspectAgentDetails.output),
      ...(c.renameAgent
        ? {
            renameAgent: (i: Parameters<NonNullable<WorkspacePorts['agents']['renameAgent']>>[0]) =>
              invoke('renameAgent', i, workspaceCommands.renameAgent.output),
          }
        : {}),
      ...(c.disableAgent
        ? {
            disableAgent: (
              i: Parameters<NonNullable<WorkspacePorts['agents']['disableAgent']>>[0]
            ) => invoke('disableAgent', i, workspaceCommands.disableAgent.output),
          }
        : {}),
      ...(c.reactivateAgent
        ? {
            reactivateAgent: (
              i: Parameters<NonNullable<WorkspacePorts['agents']['reactivateAgent']>>[0]
            ) => invoke('reactivateAgent', i, workspaceCommands.reactivateAgent.output),
          }
        : {}),
    },
    sessions: {
      listSessions: (i) => invoke('listSessions', i, workspaceCommands.listSessions.output),
      inspectSession: (i) => invoke('inspectSession', i, workspaceCommands.inspectSession.output),
      inspectSessionNavigation: (i) =>
        invoke('inspectSessionNavigation', i, workspaceCommands.inspectSessionNavigation.output),
      ...(c.renameSession
        ? {
            renameSession: (
              i: Parameters<NonNullable<WorkspacePorts['sessions']['renameSession']>>[0]
            ) => invoke('renameSession', i, workspaceCommands.renameSession.output),
          }
        : {}),
      ...(c.retireSession
        ? {
            retireSession: (
              i: Parameters<NonNullable<WorkspacePorts['sessions']['retireSession']>>[0]
            ) => invoke('retireSession', i, workspaceCommands.retireSession.output),
          }
        : {}),
      ...(c.restoreSession
        ? {
            restoreSession: (
              i: Parameters<NonNullable<WorkspacePorts['sessions']['restoreSession']>>[0]
            ) => invoke('restoreSession', i, workspaceCommands.restoreSession.output),
          }
        : {}),
      ...(c.purgeSession
        ? {
            purgeSession: (
              i: Parameters<NonNullable<WorkspacePorts['sessions']['purgeSession']>>[0]
            ) => invoke('purgeSession', i, workspaceCommands.purgeSession.output),
          }
        : {}),
      ...(c.selectSessionBranch
        ? {
            selectSessionBranch: (
              i: Parameters<NonNullable<WorkspacePorts['sessions']['selectSessionBranch']>>[0]
            ) => invoke('selectSessionBranch', i, workspaceCommands.selectSessionBranch.output),
          }
        : {}),
    },
    conversations: {
      streamInteraction: transport.streamInteraction,
      readConversation: (i) =>
        invoke('readConversation', i, workspaceCommands.readConversation.output),
      ...(c.forkSessionBranch
        ? {
            forkSessionBranch: (
              i: Parameters<NonNullable<WorkspacePorts['conversations']['forkSessionBranch']>>[0]
            ) => invoke('forkSessionBranch', i, workspaceCommands.forkSessionBranch.output),
          }
        : {}),
      ...(c.rewindSessionBranch
        ? {
            rewindSessionBranch: (
              i: Parameters<NonNullable<WorkspacePorts['conversations']['rewindSessionBranch']>>[0]
            ) => invoke('rewindSessionBranch', i, workspaceCommands.rewindSessionBranch.output),
          }
        : {}),
    },
  };
}
export async function readResponseBody(response: Response, limit: number): Promise<string> {
  if (response.body === null) return fail();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let content = '';
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) return fail();
      content += decoder.decode(chunk.value, { stream: true });
    }
    return content + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function stream(
  fetch: typeof globalThis.fetch,
  url: string,
  input: StartConversationInteractionInput,
  consume: ConversationInteractionEventConsumer
): Promise<void> {
  const { signal, ...payload } = input;
  signal?.throwIfAborted();
  let started = false;
  let terminalEvent: ConversationInteractionEvent | undefined;
  let terminalDelivered = false;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(interactionInput.decode(payload)),
      ...(signal === undefined ? {} : { signal }),
    });
    const accept = async (line: string) => {
      if (terminalEvent !== undefined) return fail();
      const event = interactionEvent.decode(JSON.parse(line));
      if (
        event.interactionId !== input.interactionId ||
        (!started && event.type !== 'interaction-started') ||
        (started && event.type === 'interaction-started')
      )
        return fail();
      started = true;
      if (
        event.type === 'completed' ||
        event.type === 'committed' ||
        event.type === 'failed' ||
        event.type === 'cancelled'
      ) {
        terminalEvent = event;
      } else {
        await consume(event);
      }
    };
    await readNdjsonResponse(response, accept, signal);
    if (terminalEvent === undefined) return fail();
    signal?.throwIfAborted();
    // A terminal frame is authoritative only after clean EOF, with no trailing data.
    terminalDelivered = true;
    await consume(terminalEvent);
  } catch (error) {
    if (terminalDelivered) throw error;
    await consume(
      signal?.aborted
        ? { type: 'cancelled', interactionId: input.interactionId }
        : {
            type: 'failed',
            interactionId: input.interactionId,
            failure: {
              code:
                error instanceof TransportProtocolError || error instanceof SyntaxError
                  ? 'invalid-stream'
                  : 'unavailable',
              message: 'The interaction transport did not complete.',
            },
          }
    );
  }
}
