import type {
  ConversationInteractionEvent,
  ConversationInteractionEventConsumer,
  StartConversationInteractionInput,
} from '@ta-agent/ui-contracts';
import type { AgentWebPorts } from '../application/ports.js';
import type { DemoAgentConfig } from '../application/demo-agent-config.js';
import { commands, type CommandName } from '../transport/commands.js';
import { TransportProtocolError, fail, type Decoder } from '../transport/decoder.js';
import { WEB_TRANSPORT_LIMITS } from '../transport/limits.js';
import { interactionEvent, interactionInput } from '../transport/schemas.js';

export interface HttpAgentWebOptions {
  /** Relative same-origin URL in browsers; an absolute URL is useful for Node qualification. */
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function createHttpAgentWebPorts(
  options: HttpAgentWebOptions = {}
): AgentWebPorts<DemoAgentConfig> {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? '/api').replace(/\/$/u, '');
  const rpc = async <T>(
    name: CommandName,
    input: { readonly signal?: AbortSignal },
    output: Decoder<T>
  ): Promise<T> => {
    const { signal, ...payload } = input;
    signal?.throwIfAborted();
    const normalized = commands[name].input.decode(payload);
    try {
      const response = await fetch(`${baseUrl}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: name, input: normalized }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json'))
        return fail();
      return output.decode(
        JSON.parse(await readBody(response, WEB_TRANSPORT_LIMITS.responseBytes))
      );
    } catch (error) {
      signal?.throwIfAborted();
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
      streamInteraction: (i, consume) => stream(fetch, `${baseUrl}/interactions`, i, consume),
    },
  };
}

async function readBody(response: Response, limit: number): Promise<string> {
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
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('application/x-ndjson') ||
      response.body === null
    )
      return fail();
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let bytes = 0;
    const accept = async (line: string) => {
      if (
        terminalEvent !== undefined ||
        new TextEncoder().encode(line).byteLength > WEB_TRANSPORT_LIMITS.frameBytes
      )
        return fail();
      const event = interactionEvent.decode(JSON.parse(line));
      if (
        event.interactionId !== input.interactionId ||
        (!started && event.type !== 'interaction-started') ||
        (started && event.type === 'interaction-started')
      )
        return fail();
      started = true;
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        terminalEvent = event;
      } else {
        await consume(event);
      }
    };
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > WEB_TRANSPORT_LIMITS.streamBytes) return fail();
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          await accept(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
        if (buffer.length > WEB_TRANSPORT_LIMITS.frameBytes) return fail();
      }
      buffer += decoder.decode();
      if (buffer.length !== 0 || terminalEvent === undefined) return fail();
      signal?.throwIfAborted();
      // A terminal frame is authoritative only after clean EOF, with no trailing data.
      terminalDelivered = true;
      await consume(terminalEvent);
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
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
              message: 'The local interaction transport did not complete.',
            },
          }
    );
  }
}
