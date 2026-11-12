import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import { WEB_TRANSPORT_LIMITS, fail, TransportProtocolError } from '@print-an-agent/ui-transport';
import { TemporaryStreamProtocol } from '../../temporary-conversation/protocol.js';
import { parseTemporaryRequest } from '../../temporary-conversation/validation.js';
import type {
  TemporaryConversationPort,
  TemporaryConversationEvent,
} from '../../temporary-conversation/contracts.js';

const MAX_PENDING_EVENTS = 64;
/** Owns admitted delivery and terminal validation until the port actually settles. */
export async function writeTemporaryConversationResponse(
  port: TemporaryConversationPort,
  payload: unknown,
  response: ServerResponse,
  parentSignal: AbortSignal
): Promise<void> {
  const input = parseTemporaryRequest(payload);
  const protocol = new TemporaryStreamProtocol(input);
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  let accepting = true;
  let pending = 0;
  let bytes = 0;
  let delivery = Promise.resolve();
  let failure: { cause: unknown } | undefined;
  const stop = (cause: unknown) => {
    failure ??= { cause };
    controller.abort(failure.cause);
    return failure.cause;
  };
  const reject = (cause: unknown) => {
    const rejected = Promise.resolve().then(() => {
      throw cause;
    });
    void rejected.catch(() => undefined);
    return rejected;
  };
  const write = async (event: TemporaryConversationEvent) => {
    if (failure !== undefined) throw failure.cause;
    signal.throwIfAborted();
    const normalized = protocol.accept(event);
    const line = `${JSON.stringify(normalized)}\n`;
    bytes += Buffer.byteLength(line);
    if (
      Buffer.byteLength(line) > WEB_TRANSPORT_LIMITS.frameBytes ||
      bytes > WEB_TRANSPORT_LIMITS.streamBytes
    )
      return fail();
    if (!response.write(line)) await once(response, 'drain', { signal });
  };
  signal.throwIfAborted();
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  try {
    await port.streamTemporaryConversation({ ...input, signal }, (event) => {
      if (failure !== undefined) return reject(failure.cause);
      if (!accepting || pending >= MAX_PENDING_EVENTS)
        return reject(stop(new TransportProtocolError()));
      pending++;
      const work = delivery.then(() => write(event));
      delivery = work.then(
        () => {
          pending--;
        },
        (cause: unknown) => {
          pending--;
          stop(cause);
        }
      );
      return work;
    });
  } catch (cause: unknown) {
    stop(cause);
  } finally {
    accepting = false;
    await delivery;
  }
  if (failure !== undefined) throw failure.cause;
  signal.throwIfAborted();
  protocol.finish();
  response.end();
}
