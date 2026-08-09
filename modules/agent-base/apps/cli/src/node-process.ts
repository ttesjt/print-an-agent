import { AgentBaseCliError } from './errors.js';
import type { AgentBaseCliProcess, AgentBaseCliWriter } from './contracts.js';

const MAX_STANDARD_INPUT_BYTES = 65_536;

function writeToStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (error?: Error | null) => (error == null ? resolve() : reject(error)));
  });
}

export function createNodeWriter(stream: NodeJS.WritableStream): AgentBaseCliWriter {
  const writer: AgentBaseCliWriter = {
    write: (text) => writeToStream(stream, text),
  };
  return Object.freeze(writer);
}

export async function readNodeStandardInput(
  input: NodeJS.ReadableStream,
  signal: AbortSignal
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of input as AsyncIterable<unknown>) {
    if (signal.aborted) throw signal.reason;
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    if (!(bytes instanceof Uint8Array)) {
      throw new AgentBaseCliError('CLI_INPUT_INVALID', 'Standard input returned invalid data.');
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_STANDARD_INPUT_BYTES) {
      throw new AgentBaseCliError('CLI_INPUT_INVALID', 'Standard input cannot exceed 64 KiB.');
    }
    chunks.push(bytes);
  }
  if (signal.aborted) throw signal.reason;
  return Buffer.concat(chunks).toString('utf8');
}

export function defaultAgentBaseCliProcess(): AgentBaseCliProcess {
  return Object.freeze({
    argv: process.argv.slice(2),
    environment: process.env,
    standardInput: process.stdin,
    standardOutput: process.stdout,
    standardError: process.stderr,
  });
}
