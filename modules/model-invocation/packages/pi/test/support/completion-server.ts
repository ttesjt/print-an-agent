import { createServer } from 'node:http';

interface CompletionServerOptions {
  readonly afterFirstChunk?: Promise<void>;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: unknown;
  }[];
}

/** Minimal deterministic OpenAI wire fixture; the adapter still uses the real Pi parser. */
export async function completionServer(options: CompletionServerOptions = {}) {
  const requests: unknown[] = [];
  const clientClosed = Promise.withResolvers<void>();
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.once('close', () => clientClosed.resolve());
      const toolCalls = requests.length === 1 ? options.toolCalls : undefined;
      const deltas =
        toolCalls === undefined
          ? [
              { role: 'assistant', reasoning_content: 'consider ' },
              { reasoning_content: 'the fact' },
              { content: 'proposed ' },
              { content: 'update' },
            ]
          : [
              {
                role: 'assistant',
                tool_calls: toolCalls.map((call, index) => ({
                  index,
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
              },
            ];
      let index = 0;
      for (const delta of deltas) {
        response.write(
          `data: ${JSON.stringify({
            id: 'completion',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fixture',
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`
        );
        if (index++ === 0) await options.afterFirstChunk;
        if (response.destroyed) return;
      }
      response.end(
        `data: ${JSON.stringify({
          id: 'completion',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [
            { index: 0, delta: {}, finish_reason: toolCalls === undefined ? 'stop' : 'tool_calls' },
          ],
        })}\n\ndata: [DONE]\n\n`
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
    clientClosed: clientClosed.promise,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
