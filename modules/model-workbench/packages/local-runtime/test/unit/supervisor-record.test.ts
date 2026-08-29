import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LOCAL_EXECUTION_SUPERVISOR_FILE,
  LOCAL_SUPERVISOR_LEASE_MILLISECONDS,
} from '../../src/foundation/constants.js';
import { claimSupervisor, SupervisorClaimKind } from '../../src/supervisor/supervisor-record.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('local supervisor ownership', () => {
  it('does not treat a live but reused PID as an active owner after its heartbeat lease expires', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-supervisor-owner-'));
    directories.push(directory);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, LOCAL_EXECUTION_SUPERVISOR_FILE),
      `${JSON.stringify({
        pid: process.pid,
        incarnation: 'previous-supervisor',
        heartbeatAt: Date.now() - LOCAL_SUPERVISOR_LEASE_MILLISECONDS - 1,
      })}\n`,
      'utf8'
    );

    await expect(claimSupervisor(directory)).resolves.toEqual({
      kind: SupervisorClaimKind.StaleOwner,
    });
  });
});
