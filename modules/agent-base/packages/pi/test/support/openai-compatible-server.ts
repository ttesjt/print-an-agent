import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

export interface OpenAICompatibleRequestSnapshot {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

export interface OpenAICompatibleTestServer {
  readonly baseUrl: string;
  requests(): readonly OpenAICompatibleRequestSnapshot[];
  close(): Promise<void>;
}

function readBody(request: AsyncIterable<Uint8Array>): Promise<string> {
  return (async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  })();
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Test server did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

export async function createOpenAICompatibleTestServer(
  responseText = 'ordinary response'
): Promise<OpenAICompatibleTestServer> {
  const captured: OpenAICompatibleRequestSnapshot[] = [];
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      response.destroy();
    });
  });
  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawBody = await readBody(request);
    captured.push(
      Object.freeze({
        url: request.url ?? '',
        headers: request.headers,
        body: JSON.parse(rawBody) as unknown,
      })
    );
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      connection: 'keep-alive',
      'cache-control': 'no-cache',
    });
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [
          { index: 0, delta: { role: 'assistant', content: responseText }, finish_reason: null },
        ],
      })}\n\n`
    );
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      })}\n\n`
    );
    response.end('data: [DONE]\n\n');
  }
  const port = await listen(server);
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests: () => Object.freeze([...captured]),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  });
}
