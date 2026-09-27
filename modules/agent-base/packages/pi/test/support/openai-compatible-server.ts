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

export interface OpenAICompatibleResponseTiming {
  readonly responseStartDelayMilliseconds?: number;
  readonly firstEventDelayMilliseconds?: number;
  readonly contentEventDelayMilliseconds?: number;
  readonly terminalEventDelayMilliseconds?: number;
}

export type OpenAICompatibleScriptedResponse =
  | Readonly<{
      kind: 'text';
      text: string;
      reasoning?: string;
      timing?: OpenAICompatibleResponseTiming;
    }>
  | Readonly<{
      kind: 'tool-call';
      id: string;
      name: string;
      arguments: Readonly<Record<string, unknown>>;
      timing?: OpenAICompatibleResponseTiming;
    }>;

function delay(milliseconds: number | undefined): Promise<void> {
  return milliseconds === undefined
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  responseText = 'ordinary response',
  reasoning?: string,
  timing: OpenAICompatibleResponseTiming = Object.freeze({})
): Promise<OpenAICompatibleTestServer> {
  return createOpenAICompatibleServer(() => ({
    kind: 'text',
    text: responseText,
    ...(reasoning === undefined ? {} : { reasoning }),
    timing,
  }));
}

export async function createScriptedOpenAICompatibleTestServer(
  responses: readonly OpenAICompatibleScriptedResponse[]
): Promise<OpenAICompatibleTestServer> {
  return createOpenAICompatibleServer((requestIndex) => {
    const scriptedResponse = responses[requestIndex];
    if (scriptedResponse === undefined) {
      throw new Error(`No scripted response exists for provider request ${requestIndex + 1}.`);
    }
    return scriptedResponse;
  });
}

async function createOpenAICompatibleServer(
  resolveResponse: (requestIndex: number) => OpenAICompatibleScriptedResponse
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
    const scriptedResponse = resolveResponse(captured.length - 1);
    const timing: OpenAICompatibleResponseTiming = scriptedResponse.timing ?? Object.freeze({});
    await delay(timing.responseStartDelayMilliseconds);
    if (response.destroyed) return;
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      connection: 'keep-alive',
      'cache-control': 'no-cache',
    });
    response.flushHeaders();
    await delay(timing.firstEventDelayMilliseconds);
    if (response.destroyed) return;
    if (scriptedResponse.kind === 'tool-call') {
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: scriptedResponse.id,
                    type: 'function',
                    function: {
                      name: scriptedResponse.name,
                      arguments: JSON.stringify(scriptedResponse.arguments),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`
      );
      await delay(timing.terminalEventDelayMilliseconds);
      if (response.destroyed) return;
      writeTerminalEvent(response, 'tool_calls');
    } else {
      if (scriptedResponse.reasoning !== undefined) {
        response.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', reasoning_content: scriptedResponse.reasoning },
                finish_reason: null,
              },
            ],
          })}\n\n`
        );
        await delay(timing.contentEventDelayMilliseconds);
        if (response.destroyed) return;
      }
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: scriptedResponse.text },
              finish_reason: null,
            },
          ],
        })}\n\n`
      );
      await delay(timing.terminalEventDelayMilliseconds);
      if (response.destroyed) return;
      writeTerminalEvent(response, 'stop');
    }
    response.end('data: [DONE]\n\n');
  }
  const port = await listen(server);
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests: () => Object.freeze([...captured]),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  });
}

function writeTerminalEvent(response: ServerResponse, finishReason: 'stop' | 'tool_calls'): void {
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    })}\n\n`
  );
}
