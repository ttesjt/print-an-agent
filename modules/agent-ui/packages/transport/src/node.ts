import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { WorkspaceConversationPort, WorkspacePorts } from '@ta-agent/ui-contracts';
import { fail, object, text, TransportProtocolError } from './decoder.js';
import { WEB_TRANSPORT_LIMITS } from './limits.js';
import { interactionEvent, interactionInput } from './schemas.js';
import { workspaceCommands, workspaceCommandName } from './commands.js';
export const commandEnvelope = object({
  command: text(128, 1),
  input: { decode: (value: unknown) => value },
});
export async function dispatchWorkspaceCommand(
  ports: WorkspacePorts,
  payload: unknown,
  signal: AbortSignal
): Promise<unknown> {
  const envelope = commandEnvelope.decode(payload);
  signal.throwIfAborted();
  return workspaceCommands[workspaceCommandName(envelope.command)].run(
    ports,
    envelope.input,
    signal
  );
}
export function writeJsonResponse(response: ServerResponse, value: unknown) {
  const json = JSON.stringify(value, (_key, item: unknown) => (item === undefined ? null : item));
  if (Buffer.byteLength(json) > WEB_TRANSPORT_LIMITS.responseBytes) return fail();
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(json);
}
/** Resolves only after clean terminal settlement. Caller destroys the response on rejection. */
export async function writeInteractionResponse(
  port: WorkspaceConversationPort,
  payload: unknown,
  response: ServerResponse,
  signal: AbortSignal
) {
  const input = interactionInput.decode(payload);
  signal.throwIfAborted();
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  let terminal = false;
  let started = false;
  let bytes = 0;
  let delivery = Promise.resolve();
  let failure: Error | undefined;
  let accepting = true;
  const write = async (event: unknown) => {
    if (failure !== undefined) throw failure;
    signal.throwIfAborted();
    const normalized = interactionEvent.decode(event);
    if (
      terminal ||
      normalized.interactionId !== input.interactionId ||
      (!started && normalized.type !== 'interaction-started') ||
      (started && normalized.type === 'interaction-started')
    )
      return fail();
    started = true;
    terminal =
      normalized.type === 'completed' ||
      normalized.type === 'committed' ||
      normalized.type === 'failed' ||
      normalized.type === 'cancelled';
    const line = `${JSON.stringify(normalized)}\n`;
    bytes += Buffer.byteLength(line);
    if (
      Buffer.byteLength(line) > WEB_TRANSPORT_LIMITS.frameBytes ||
      bytes > WEB_TRANSPORT_LIMITS.streamBytes
    )
      return fail();
    if (!response.write(line)) await once(response, 'drain', { signal });
  };
  try {
    await port.streamInteraction({ ...input, signal }, (event) => {
      if (!accepting) return Promise.reject(new Error('Interaction delivery has closed.'));
      const work = delivery.then(() => write(event));
      delivery = work.catch((error: unknown) => {
        failure ??= error instanceof Error ? error : new TransportProtocolError();
      });
      return work;
    });
  } catch (error) {
    failure ??= error instanceof Error ? error : new TransportProtocolError();
  } finally {
    accepting = false;
    await delivery;
  }
  if (failure !== undefined) throw failure;
  if (!terminal) return fail();
  response.end();
}
export async function readJsonRequest(
  request: IncomingMessage,
  signal: AbortSignal
): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const raw of request) {
    signal.throwIfAborted();
    const chunk: unknown = raw;
    if (!Buffer.isBuffer(chunk)) return fail();
    bytes += chunk.byteLength;
    if (bytes > WEB_TRANSPORT_LIMITS.requestBytes) return fail();
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
