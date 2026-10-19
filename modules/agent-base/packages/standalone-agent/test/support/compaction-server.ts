import { createServer } from 'node:http';

/** Deterministic wire fixture: official provider composition still runs the real Pi parser. */
export async function compactionServer(outputs: readonly string[]) {
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      const text = outputs[requests.length - 1];
      if (text === undefined) {
        response.writeHead(500);
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const packet = (delta: object, finishReason: string | null) =>
        `data: ${JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`;
      response.write(packet({ role: 'assistant', content: text }, null));
      response.end(packet({}, 'stop') + 'data: [DONE]\n\n');
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
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address.');
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
