export interface AgentBaseCliWriter {
  write(text: string): Promise<void>;
}

export interface AgentBaseCliRuntime {
  checkProvider(signal: AbortSignal): Promise<unknown>;
  run(
    input: Readonly<{
      message: string;
      sessionId?: string;
      idempotencyKey?: string;
    }>,
    options: Readonly<{
      signal: AbortSignal;
      writeTextDelta(delta: string): Promise<void>;
    }>
  ): Promise<unknown>;
  compactSession(
    input: Readonly<{ sessionId: string; branchId?: string }>,
    signal: AbortSignal
  ): Promise<unknown>;
  inspectSession(sessionId: string, signal: AbortSignal): Promise<unknown>;
  selectSessionBranch(
    input: Readonly<{ sessionId: string; branchId: string; expectedRevision: number }>,
    signal: AbortSignal
  ): Promise<unknown>;
  forkSessionBranch(
    input: Readonly<{
      sessionId: string;
      sourceBranchId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>,
    signal: AbortSignal
  ): Promise<unknown>;
  rewindSession(
    input: Readonly<{
      sessionId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>,
    signal: AbortSignal
  ): Promise<unknown>;
}

export interface AgentBaseCliDependencies {
  readonly loadRuntime: (configPath: string) => Promise<AgentBaseCliRuntime>;
  readonly readStandardInput: (signal: AbortSignal) => Promise<string>;
  readonly standardOutput: AgentBaseCliWriter;
  readonly standardError: AgentBaseCliWriter;
  readonly signal: AbortSignal;
}

export interface AgentBaseCliProcess {
  readonly argv: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly standardInput: NodeJS.ReadableStream;
  readonly standardOutput: NodeJS.WritableStream;
  readonly standardError: NodeJS.WritableStream;
}
