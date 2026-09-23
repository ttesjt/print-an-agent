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
      sessionOpened(sessionId: string): Promise<void>;
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

export type AgentBaseCliRuntimeLocator =
  | Readonly<{ kind: 'config'; configPath: string }>
  | Readonly<{ kind: 'managed'; rootDirectory: string; agentId: string }>;

export interface AgentBaseCliManagedDirectory {
  create(manifest: unknown): Promise<unknown>;
  list(): Promise<unknown>;
  inspect(agentId: string): Promise<unknown>;
  disable(agentId: string, expectedRevision: number): Promise<unknown>;
  reactivate(agentId: string, expectedRevision: number): Promise<unknown>;
}

export interface AgentBaseCliDependencies {
  readonly loadRuntime: (locator: AgentBaseCliRuntimeLocator) => Promise<AgentBaseCliRuntime>;
  readonly loadManagedDirectory: (rootDirectory: string) => Promise<AgentBaseCliManagedDirectory>;
  readonly readJsonDocument: (path: string) => Promise<unknown>;
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
