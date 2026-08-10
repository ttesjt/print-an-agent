import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type LoopbackProviderResponse =
  | Readonly<{ status: 'success'; chunks: readonly string[] }>
  | Readonly<{ status: 'failure'; statusCode: number }>;

export interface LoopbackProvider {
  readonly baseUrl: string;
  requests(): readonly Readonly<Record<string, unknown>>[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Loopback provider did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function readRequest(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(chunk);
    else throw new Error('Loopback provider received an unsupported body chunk.');
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Loopback provider expected an object request body.');
  }
  return Object.freeze({ ...value });
}

function writeSuccess(response: ServerResponse, chunks: readonly string[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const content of chunks) {
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-agent-integration',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'qualification-model',
        choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
      })}\n\n`
    );
  }
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-agent-integration',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'qualification-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    })}\n\n`
  );
  response.end('data: [DONE]\n\n');
}

export async function startLoopbackProvider(
  responses: readonly LoopbackProviderResponse[]
): Promise<LoopbackProvider> {
  const captured: Readonly<Record<string, unknown>>[] = [];
  let responseIndex = 0;
  const server = createServer((request, response) => {
    void (async () => {
      captured.push(await readRequest(request));
      const planned = responses[responseIndex++];
      if (planned === undefined) {
        response.writeHead(500).end();
        return;
      }
      if (planned.status === 'failure') {
        response.writeHead(planned.statusCode, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'synthetic provider failure' } }));
        return;
      }
      writeSuccess(response, planned.chunks);
    })().catch(() => response.destroy());
  });
  const port = await listen(server);
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests: () => Object.freeze(captured.map((request) => Object.freeze({ ...request }))),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  });
}
