import type { ModelWorkbenchCliProcess, ModelWorkbenchCliWriter } from './contracts.js';

function writeToStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (error?: Error | null) => (error == null ? resolve() : reject(error)));
  });
}

export function createNodeWriter(stream: NodeJS.WritableStream): ModelWorkbenchCliWriter {
  return Object.freeze({ write: (text: string) => writeToStream(stream, text) });
}

export function defaultModelWorkbenchCliProcess(): ModelWorkbenchCliProcess {
  return Object.freeze({
    argv: process.argv.slice(2),
    standardInput: process.stdin,
    standardOutput: process.stdout,
    standardError: process.stderr,
  });
}
