import { createServer } from 'node:http';

/** Bounded SSE script consumed by the actual Pi public parser, not a model mock. */
export async function compactionProviderServer(
  outputs: readonly { readonly text: string; readonly finishReason?: 'stop' | 'length' }[]
) {
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const output = outputs[requests.length];
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      if (output === undefined) {
        response.writeHead(500).end('Fixture script exhausted');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const choice of [
        { index: 0, delta: { role: 'assistant', content: output.text }, finish_reason: null },
        { index: 0, delta: {}, finish_reason: output.finishReason ?? 'stop' },
      ]) {
        response.write(
          `data: ${JSON.stringify({ id: 'compaction', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [choice] })}\n\n`
        );
      }
      response.end('data: [DONE]\n\n');
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
