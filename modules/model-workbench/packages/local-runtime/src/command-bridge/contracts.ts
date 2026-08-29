import type { JsonValue } from '@ta-agent/workbench-domain';
import { CapabilityDispatchKind, type ExtensionCallOptions } from '@ta-agent/workbench-extension';

import type { LocalExecutionReceipt } from '../execution/contracts.js';
import type { LocalCommandProtocolMessageKind } from '../foundation/constants.js';

export interface LocalCommandDefinition {
  readonly executable: string;
  readonly arguments?: readonly string[];
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly inheritEnvironment?: boolean;
}

export interface LocalCommandBridgeOptions {
  readonly rootDirectory: string;
  readonly command: LocalCommandDefinition;
  readonly maximumProtocolMessageBytes?: number;
  readonly maximumStderrBytes?: number;
  readonly cancellationGraceMilliseconds?: number;
  readonly cancellationPollMilliseconds?: number;
  readonly supervisorStartupTimeoutMilliseconds?: number;
}

export interface LocalCommandAcceptedDispatch {
  readonly kind: typeof CapabilityDispatchKind.Accepted;
  readonly executionReceipt: LocalExecutionReceipt;
}

export interface LocalCommandBridge {
  dispatch(request: unknown, options?: ExtensionCallOptions): Promise<LocalCommandAcceptedDispatch>;
}

export interface LocalCommandProgressMessage {
  readonly kind: typeof LocalCommandProtocolMessageKind.Progress;
  readonly progress?: JsonValue;
}

export interface LocalCommandTerminalMessage {
  readonly kind: typeof LocalCommandProtocolMessageKind.Terminal;
  readonly terminal: unknown;
}

export type LocalCommandProtocolMessage = LocalCommandProgressMessage | LocalCommandTerminalMessage;

export interface LocalCommandLaunchRecord {
  readonly kind: typeof LocalCommandLaunchKind.Command;
  readonly commandDigest: string;
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory?: string;
  readonly maximumProtocolMessageBytes: number;
  readonly maximumStderrBytes: number;
  readonly cancellationGraceMilliseconds: number;
  readonly cancellationPollMilliseconds: number;
}

export const LocalCommandLaunchKind = {
  Command: 'local-command-launch',
} as const;

export type LocalCommandLaunchKind =
  (typeof LocalCommandLaunchKind)[keyof typeof LocalCommandLaunchKind];

export interface LocalCommandWorkspace {
  readonly executionId: string;
  readonly executionDirectory: string;
  readonly request: JsonValue;
  readonly launch: LocalCommandLaunchRecord;
  readonly environment: Readonly<Record<string, string>>;
}
