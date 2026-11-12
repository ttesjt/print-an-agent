import { fail, literal, object, union, type Decoder } from '@print-an-agent/ui-transport';
import { id } from '../../memory/schemas/common.js';
import {
  memoryCapabilities,
  type ContextMemoryPort,
  type RetrievalMemoryPort,
  type WebMemoryPorts,
} from '../../memory/contracts.js';
import { contextCodecs as c } from '../../memory/schemas/context.js';
import { retrievalCodecs as r } from '../../memory/schemas/retrieval.js';

const envelope = object({
  domain: union(literal('capabilities'), literal('context'), literal('retrieval')),
  operation: id,
  input: { decode: (value: unknown) => value },
});
function command<P, I extends object, O>(
  codec: { readonly input: Decoder<I>; readonly output: Decoder<O> },
  invoke: (ports: P, input: I & { signal: AbortSignal }) => Promise<O>
) {
  return async (port: P, input: unknown, signal: AbortSignal): Promise<O> =>
    codec.output.decode(await invoke(port, { ...codec.input.decode(input), signal }));
}
const context = {
  inspect: command(c.inspect, (p: ContextMemoryPort, i) => p.inspect(i)),
  getReceipt: command(c.getReceipt, (p: ContextMemoryPort, i) => p.getReceipt(i)),
  readContext: command(c.readContext, (p: ContextMemoryPort, i) => p.readContext(i)),
  create: command(c.create, (p: ContextMemoryPort, i) => p.create(i)),
  apply: command(c.apply, (p: ContextMemoryPort, i) => p.apply(i)),
  configure: command(c.configure, (p: ContextMemoryPort, i) => p.configure(i)),
};
const retrieval = {
  inspect: command(r.inspect, (p: RetrievalMemoryPort, i) => p.inspect(i)),
  get: command(r.get, (p: RetrievalMemoryPort, i) => p.get(i)),
  getReceipt: command(r.getReceipt, (p: RetrievalMemoryPort, i) => p.getReceipt(i)),
  list: command(r.list, (p: RetrievalMemoryPort, i) => p.list(i)),
  search: command(r.search, (p: RetrievalMemoryPort, i) => p.search(i)),
  readContext: command(r.readContext, (p: RetrievalMemoryPort, i) => p.readContext(i)),
  create: command(r.create, (p: RetrievalMemoryPort, i) => p.create(i)),
  ingest: command(r.ingest, (p: RetrievalMemoryPort, i) => p.ingest(i)),
  update: command(r.update, (p: RetrievalMemoryPort, i) => p.update(i)),
  remove: command(r.remove, (p: RetrievalMemoryPort, i) => p.remove(i)),
  reindex: command(r.reindex, (p: RetrievalMemoryPort, i) => p.reindex(i)),
};
export async function runMemoryCommand(
  ports: WebMemoryPorts | undefined,
  body: unknown,
  signal: AbortSignal
): Promise<unknown> {
  const input = envelope.decode(body);
  signal.throwIfAborted();
  if (input.domain === 'capabilities') {
    object({}).decode(input.input);
    if (input.operation !== 'inspect') return fail();
    return memoryCapabilities.decode(ports?.capabilities ?? {});
  }
  if (input.domain === 'context') {
    if (ports?.context === undefined || !Object.hasOwn(context, input.operation)) return fail();
    return context[input.operation as keyof typeof context](ports.context, input.input, signal);
  }
  if (ports?.retrieval === undefined || !Object.hasOwn(retrieval, input.operation)) return fail();
  return retrieval[input.operation as keyof typeof retrieval](ports.retrieval, input.input, signal);
}
