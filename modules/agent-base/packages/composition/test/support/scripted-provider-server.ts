import { createServer } from 'node:http';

/** Local wire script; requests still traverse the real Pi SDK and SSE parser. */
export async function scriptedProviderServer(
  turns: readonly {
    readonly deltas: readonly unknown[];
    readonly finishReason: 'stop' | 'tool_calls';
  }[]
) {
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const turn = turns[requests.length];
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      if (turn === undefined) {
        response.writeHead(500).end('script exhausted');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const delta of turn.deltas) {
        response.write(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
        );
      }
      response.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: turn.finishReason }] })}\n\ndata: [DONE]\n\n`
      );
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
