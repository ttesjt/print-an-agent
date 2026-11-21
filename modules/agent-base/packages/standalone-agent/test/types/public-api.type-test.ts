import { expectTypeOf } from 'vitest';
import {
  createAgentRuntimeService,
  type ManagedAgentAuthorityPorts,
} from '@print-an-agent/base-composition';
import type { CoordinatedSessionPersistence } from '@print-an-agent/base-local-adapters';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import type {
  CreateStandaloneMemoryProfileOptions,
  StandaloneRawAgent,
  StandaloneSetup,
  projectStandaloneSessionManagementService,
} from '../../src/index.js';

declare const setup: StandaloneSetup<{ readonly externalReference: string }>;
declare const authority: ManagedAgentAuthorityPorts;
declare const persistence: CoordinatedSessionPersistence;

const opened = createAgentRuntimeService(setup.definition).open(parseAgentId('external'));
void opened;
expectTypeOf<Awaited<typeof opened>>().toEqualTypeOf<StandaloneRawAgent>();
// This legacy root export deliberately remains type-only.
expectTypeOf<Parameters<typeof projectStandaloneSessionManagementService>>().toBeArray();

export const memoryOptions: CreateStandaloneMemoryProfileOptions = {
  readEnvironmentVariable: () => undefined,
  acquireAuthority: ({ agentId, allocationId, signal }) => {
    expectTypeOf(agentId).toEqualTypeOf<string>();
    expectTypeOf(allocationId).toEqualTypeOf<string>();
    expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
    return { value: authority, release: () => Promise.resolve() };
  },
  acquireSessionPersistence: ({ signal }) => {
    expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
    return Promise.resolve({ value: persistence });
  },
};
