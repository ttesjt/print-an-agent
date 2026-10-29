export interface AgentBaseCliWriter {
  write(text: string): Promise<void>;
}

export interface AgentBaseCliRuntime {
  /** Present when the loader transferred an owning setup to this CLI host handle. */
  close?(): Promise<void>;
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
}

export interface AgentBaseCliSessionNavigator {
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

export interface AgentBaseCliProvider {
  check(signal: AbortSignal): Promise<unknown>;
}

export type AgentBaseCliStorageLocator =
  | Readonly<{ kind: 'directory'; rootDirectory: string }>
  | Readonly<{ kind: 'sqlite'; databasePath: string }>;

export type AgentBaseCliRuntimeLocator =
  | Readonly<{ kind: 'config'; configPath: string }>
  | AgentBaseCliManagedAgentLocator;

export type AgentBaseCliManagedAgentLocator = AgentBaseCliStorageLocator &
  Readonly<{ agentId: string }>;

export interface AgentBaseCliAgentManager {
  create(manifest: unknown): Promise<unknown>;
  list(): Promise<unknown>;
  inspect(agentId: string): Promise<unknown>;
  disable(agentId: string, expectedRevision: number): Promise<unknown>;
  reactivate(agentId: string, expectedRevision: number): Promise<unknown>;
}

export interface AgentBaseCliSessionManager {
  list(
    input: Readonly<{
      cursor?: Readonly<{ updatedAt: number; sessionId: string }>;
      limit?: number;
    }>
  ): Promise<unknown>;
  listRetired(
    input: Readonly<{
      cursor?: Readonly<{ retiredAt: number; sessionId: string }>;
      limit?: number;
    }>
  ): Promise<unknown>;
  inspect(sessionId: string): Promise<unknown>;
  listTurns(
    input: Readonly<{ sessionId: string; beforeTurnId?: string; limit?: number }>
  ): Promise<unknown>;
  retire(sessionId: string, expectedRevision: number): Promise<unknown>;
  restore(sessionId: string, expectedRevision: number): Promise<unknown>;
  purge(sessionId: string, expectedRevision: number): Promise<void>;
  recover(sessionId: string, expectedExecutionRevision: number): Promise<unknown>;
}

export interface AgentBaseCliDependencies {
  readonly loadProvider: (locator: AgentBaseCliRuntimeLocator) => Promise<AgentBaseCliProvider>;
  readonly loadRuntime: (locator: AgentBaseCliRuntimeLocator) => Promise<AgentBaseCliRuntime>;
  readonly loadSessionNavigator: (
    locator: AgentBaseCliManagedAgentLocator
  ) => Promise<AgentBaseCliSessionNavigator>;
  readonly loadAgentManager: (
    locator: AgentBaseCliStorageLocator
  ) => Promise<AgentBaseCliAgentManager>;
  readonly loadSessionManager: (
    rootDirectory: string,
    agentId: string
  ) => Promise<AgentBaseCliSessionManager>;
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
