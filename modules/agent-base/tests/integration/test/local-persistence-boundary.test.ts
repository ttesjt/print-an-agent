import { readFileSync } from 'node:fs';
import type {
  CoordinatedSessionMaintenance,
  CoordinatedSessionPersistence,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@print-an-agent/base-local-adapters';
import type { SessionExecutionRecoveryPort, SessionPurgePort } from '@print-an-agent/base-session';
import { describe, expect, expectTypeOf, it } from 'vitest';

type IsAssignable<Source, Target> = Source extends Target ? true : false;

describe('local persistence public boundary', () => {
  it('does not substitute cross-domain maintenance for Session-only authority', () => {
    expectTypeOf<
      CoordinatedSessionPersistence['maintenance']
    >().toEqualTypeOf<CoordinatedSessionMaintenance>();
    expectTypeOf<
      IsAssignable<CoordinatedSessionMaintenance, SessionPurgePort>
    >().toEqualTypeOf<false>();
    expectTypeOf<
      IsAssignable<CoordinatedSessionMaintenance, SessionExecutionRecoveryPort>
    >().toEqualTypeOf<false>();
    expectTypeOf<
      IsAssignable<SessionPurgePort & SessionExecutionRecoveryPort, CoordinatedSessionMaintenance>
    >().toEqualTypeOf<false>();
    expectTypeOf<keyof CoordinatedSessionMaintenance>().toEqualTypeOf<
      'purgeSessionPersistence' | 'recoverSessionPersistence'
    >();
  });

  it('keeps Memory coordination symbol members out of consumer types', () => {
    expectTypeOf<Extract<keyof MemorySessionAdapter, symbol>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof MemoryRequestJournalAdapter, symbol>>().toEqualTypeOf<never>();
    expectTypeOf<
      IsAssignable<MemorySessionAdapter, SessionPurgePort & SessionExecutionRecoveryPort>
    >().toEqualTypeOf<true>();
  });

  it.each([
    ['session/memory/memory-session-adapter.d.ts', 'MemorySessionAdapter'],
    ['request/memory-request-journal-adapter.d.ts', 'MemoryRequestJournalAdapter'],
  ])('omits internal coordination imports and methods from %s', (path, className) => {
    const declaration = readFileSync(
      new URL(`../../../packages/local-adapters/dist/${path}`, import.meta.url),
      'utf8'
    );
    expect(declaration).toContain(`export declare class ${className}`);
    expect(declaration).not.toMatch(
      /memory-coordination|memorySessionCoordination|memoryJournalCoordination/
    );
    expect(declaration).not.toMatch(/\b(checkpoint|bindExecution|fenceRecovery|assertWrite)\b/);
  });
});
