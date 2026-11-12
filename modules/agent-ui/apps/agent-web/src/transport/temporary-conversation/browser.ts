import {
  readNdjsonResponse,
  type HttpTransportOptions,
} from '@print-an-agent/ui-transport/browser';
import { parseTemporaryRequest } from '../../temporary-conversation/validation.js';
import {
  TemporaryStreamProtocol,
  isTemporaryTerminal,
  type TemporaryTerminalEvent,
} from '../../temporary-conversation/protocol.js';
import type { TemporaryConversationPort } from '../../temporary-conversation/contracts.js';
import { fail } from '@print-an-agent/ui-transport';

export function createHttpTemporaryConversationPort(
  options: HttpTransportOptions = {}
): TemporaryConversationPort {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (options.baseUrl ?? '/api').replace(/\/$/u, '') + '/temporary-conversations';
  return {
    async streamTemporaryConversation(request, consume) {
      const { signal, ...payload } = request;
      const input = parseTemporaryRequest(payload);
      signal?.throwIfAborted();
      const protocol = new TemporaryStreamProtocol(input);
      let terminal: TemporaryTerminalEvent | undefined;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        ...(signal === undefined ? {} : { signal }),
      });
      await readNdjsonResponse(
        response,
        async (line) => {
          const value = protocol.accept(JSON.parse(line));
          if (isTemporaryTerminal(value)) terminal = value;
          else await consume(value);
        },
        signal
      );
      protocol.finish();
      signal?.throwIfAborted();
      if (terminal === undefined) return fail();
      await consume(terminal);
    },
  };
}
