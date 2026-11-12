import type { ModelWorkbench } from '@print-an-agent/workbench-application';

export interface ModelWorkbenchCliWriter {
  write(text: string): Promise<void>;
}

export interface LoadedModelWorkbenchApplication {
  readonly workbench: ModelWorkbench;
  close(): Promise<void>;
}

export interface ModelWorkbenchCliDependencies {
  readonly loadApplication: (modulePath: string) => Promise<LoadedModelWorkbenchApplication>;
  readonly readJsonDocument: (path: string, signal: AbortSignal) => Promise<unknown>;
  readonly standardOutput: ModelWorkbenchCliWriter;
  readonly standardError: ModelWorkbenchCliWriter;
  readonly signal: AbortSignal;
}

export interface ModelWorkbenchCliProcess {
  readonly argv: readonly string[];
  readonly standardInput: NodeJS.ReadableStream;
  readonly standardOutput: NodeJS.WritableStream;
  readonly standardError: NodeJS.WritableStream;
}
