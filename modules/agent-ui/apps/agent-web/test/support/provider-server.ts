import { createServer } from 'node:http';
import { once } from 'node:events';

/** Deterministic wire fixture, parsed by the real Pi provider implementation. */
export async function providerServer() {
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const raw of request) {
        const chunk: unknown = raw;
        if (!Buffer.isBuffer(chunk)) throw new Error('Invalid fixture body');
        chunks.push(chunk);
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = (data: unknown, finishReason: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: data, finish_reason: finishReason }] })}\n\n`
        );
      delta({
        role: 'assistant',
        reasoning_content: requests.length === 1 ? 'Before tool' : 'After tool',
      });
      if (requests.length === 1) {
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'lookup-call',
              type: 'function',
              function: { name: 'lookup', arguments: '{}' },
            },
          ],
        });
        delta({}, 'tool_calls');
      } else {
        delta({ content: 'Final answer' });
        delta({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    })().catch(() => response.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}
