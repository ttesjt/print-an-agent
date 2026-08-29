import { randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  LOCAL_EXECUTION_SUPERVISOR_FILE,
  LOCAL_SUPERVISOR_HEARTBEAT_MILLISECONDS,
  LOCAL_SUPERVISOR_LEASE_MILLISECONDS,
} from '../foundation/constants.js';

export const SupervisorClaimKind = {
  Owner: 'owner',
  ActiveOwner: 'active-owner',
  StaleOwner: 'stale-owner',
} as const;

export interface SupervisorOwnership {
  readonly incarnation: string;
}

export type SupervisorClaim =
  | {
      readonly kind: typeof SupervisorClaimKind.Owner;
      readonly ownership: SupervisorOwnership;
    }
  | {
      readonly kind: typeof SupervisorClaimKind.ActiveOwner;
    }
  | {
      readonly kind: typeof SupervisorClaimKind.StaleOwner;
    };

interface SupervisorRecord {
  readonly pid: number;
  readonly incarnation: string;
  readonly heartbeatAt: number;
}

export async function claimSupervisor(executionDirectory: string): Promise<SupervisorClaim> {
  const path = supervisorRecordPath(executionDirectory);
  const ownership = Object.freeze({ incarnation: randomUUID() });
  try {
    await writeExclusiveRecord(path, createRecord(ownership));
    return Object.freeze({ kind: SupervisorClaimKind.Owner, ownership });
  } catch (cause: unknown) {
    if (!isExistingFileError(cause)) throw cause;
  }

  const record = await readSupervisorRecord(path);
  const active =
    processIsAlive(record.pid) &&
    Date.now() - record.heartbeatAt <= LOCAL_SUPERVISOR_LEASE_MILLISECONDS;
  return Object.freeze({
    kind: active ? SupervisorClaimKind.ActiveOwner : SupervisorClaimKind.StaleOwner,
  });
}

export function startSupervisorHeartbeat(
  executionDirectory: string,
  ownership: SupervisorOwnership
): () => void {
  let stopped = false;
  let updateInProgress = false;
  const update = async (): Promise<void> => {
    if (stopped || updateInProgress) return;
    updateInProgress = true;
    try {
      const path = supervisorRecordPath(executionDirectory);
      const current = await readSupervisorRecord(path);
      if (current.incarnation !== ownership.incarnation) {
        stopped = true;
        return;
      }
      await replaceRecord(path, createRecord(ownership));
    } finally {
      updateInProgress = false;
    }
  };
  const timer = setInterval(
    () => void update().catch(() => undefined),
    LOCAL_SUPERVISOR_HEARTBEAT_MILLISECONDS
  );
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function createRecord(ownership: SupervisorOwnership): SupervisorRecord {
  return Object.freeze({
    pid: process.pid,
    incarnation: ownership.incarnation,
    heartbeatAt: Date.now(),
  });
}

async function writeExclusiveRecord(path: string, record: SupervisorRecord): Promise<void> {
  const handle = await open(
    path,
    fileConstants.O_WRONLY |
      fileConstants.O_CREAT |
      fileConstants.O_EXCL |
      fileConstants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceRecord(path: string, record: SupervisorRecord): Promise<void> {
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    await writeExclusiveRecord(temporaryPath, record);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readSupervisorRecord(path: string): Promise<SupervisorRecord> {
  return parseSupervisorRecord(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

function parseSupervisorRecord(input: unknown): SupervisorRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid local supervisor record.');
  }
  const record = input as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== 3 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.incarnation !== 'string' ||
    record.incarnation.length === 0 ||
    !Number.isSafeInteger(record.heartbeatAt) ||
    (record.heartbeatAt as number) < 0
  ) {
    throw new Error('Invalid local supervisor record.');
  }
  return Object.freeze({
    pid: record.pid as number,
    incarnation: record.incarnation,
    heartbeatAt: record.heartbeatAt as number,
  });
}

function supervisorRecordPath(executionDirectory: string): string {
  return join(executionDirectory, LOCAL_EXECUTION_SUPERVISOR_FILE);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    return isNodeError(cause) && cause.code === 'EPERM';
  }
}

function isExistingFileError(cause: unknown): boolean {
  return isNodeError(cause) && cause.code === 'EEXIST';
}

function isNodeError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && 'code' in cause;
}
