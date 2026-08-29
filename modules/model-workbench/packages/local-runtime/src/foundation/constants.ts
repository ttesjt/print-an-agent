export const LocalArtifactReceiptKind = {
  Directory: 'local-directory',
} as const;

export type LocalArtifactReceiptKind =
  (typeof LocalArtifactReceiptKind)[keyof typeof LocalArtifactReceiptKind];

export const LocalArtifactMaterializationKind = {
  Directory: 'local-directory',
} as const;

export type LocalArtifactMaterializationKind =
  (typeof LocalArtifactMaterializationKind)[keyof typeof LocalArtifactMaterializationKind];

export const LocalExecutionReceiptKind = {
  FilesystemRecord: 'local-filesystem-execution',
} as const;

export type LocalExecutionReceiptKind =
  (typeof LocalExecutionReceiptKind)[keyof typeof LocalExecutionReceiptKind];

export const LOCAL_ARTIFACT_PROTOCOL = 'workbench.local-directory-artifact';
export const LOCAL_EXECUTION_PROTOCOL = 'workbench.local-filesystem-execution';

export const LOCAL_EXECUTION_OBSERVATION_FILE = 'observation.json';
export const LOCAL_EXECUTION_CANCELLATION_FILE = 'cancellation-requested';
export const LOCAL_EXECUTION_REQUEST_FILE = 'request.json';
export const LOCAL_EXECUTION_LAUNCH_FILE = 'launch.json';
export const LOCAL_EXECUTION_SUPERVISOR_FILE = 'supervisor.json';
export const LOCAL_EXECUTION_SUPERVISOR_READY_FILE = 'supervisor-ready';
export const LOCAL_EXECUTION_STDERR_FILE = 'stderr.log';
export const MAXIMUM_EXECUTION_OBSERVATION_BYTES = 1_048_576;

export const LocalCommandProtocolMessageKind = {
  Progress: 'progress',
  Terminal: 'terminal',
} as const;

export type LocalCommandProtocolMessageKind =
  (typeof LocalCommandProtocolMessageKind)[keyof typeof LocalCommandProtocolMessageKind];

export const LOCAL_COMMAND_PROTOCOL = 'workbench.local-command-jsonl';
export const LOCAL_OUTPUT_INVOCATION_PROTOCOL = 'workbench.local-output-invocation-jsonl';
export const LocalOutputInvocationMessageKind = {
  Completed: 'completed',
  StreamStart: 'stream-start',
  Chunk: 'chunk',
} as const;

export type LocalOutputInvocationMessageKind =
  (typeof LocalOutputInvocationMessageKind)[keyof typeof LocalOutputInvocationMessageKind];
export const MAXIMUM_LOCAL_COMMAND_REQUEST_BYTES = 4 * 1_048_576;
export const DEFAULT_MAXIMUM_LOCAL_COMMAND_MESSAGE_BYTES = 1_048_576;
export const DEFAULT_MAXIMUM_LOCAL_COMMAND_STDERR_BYTES = 1_048_576;
export const DEFAULT_LOCAL_COMMAND_CANCELLATION_GRACE_MILLISECONDS = 2_000;
export const DEFAULT_LOCAL_COMMAND_CANCELLATION_POLL_MILLISECONDS = 100;
export const DEFAULT_LOCAL_SUPERVISOR_STARTUP_TIMEOUT_MILLISECONDS = 5_000;
export const LOCAL_SUPERVISOR_POLL_MILLISECONDS = 25;
export const LOCAL_SUPERVISOR_HEARTBEAT_MILLISECONDS = 500;
export const LOCAL_SUPERVISOR_LEASE_MILLISECONDS = 5_000;
