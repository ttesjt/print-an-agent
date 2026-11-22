import { expectTypeOf, it } from 'vitest';
import {
  createMemoryInspectDefinition,
  createMemoryGetReceiptDefinition,
  createMemoryCreateDefinition,
  createMemoryApplyDefinition,
  createMemoryConfigureDefinition,
  createMemoryReadContextDefinition,
  createMemoryInspectVersionDefinition,
  createMemoryListVersionsDefinition,
  createMemoryForkDefinition,
  createMemoryReadVersionContextDefinition,
} from '@print-an-agent/context-memory';
import type {
  MemoryDefinition,
  MemorySnapshot,
  MemoryReceipt,
  GetMemoryReceiptInput,
  CreateMemoryInput,
  ApplyMemoryInput,
  ConfigureMemoryInput,
  MutationResult,
  ReadContextInput,
  ReadContextResult,
  MemoryVersionReference,
  ListMemoryVersionsInput,
  MemoryHistoryPage,
  ForkMemoryInput,
  MemoryHistoryOperations,
  ReadMemoryVersionContextInput,
  VersionedMemoryOperations,
} from '@print-an-agent/context-memory';
it('preserves public Definition contracts across all deterministic and history profiles', () => {
  expectTypeOf(createMemoryInspectDefinition()).toEqualTypeOf<
    MemoryDefinition<{ readonly memoryId: string }, MemorySnapshot | undefined, 'inspect'>
  >();
  expectTypeOf(createMemoryGetReceiptDefinition()).toEqualTypeOf<
    MemoryDefinition<GetMemoryReceiptInput, MemoryReceipt | undefined, 'getReceipt'>
  >();
  expectTypeOf(createMemoryCreateDefinition()).toEqualTypeOf<
    MemoryDefinition<CreateMemoryInput, MutationResult, 'create'>
  >();
  expectTypeOf(createMemoryApplyDefinition()).toEqualTypeOf<
    MemoryDefinition<ApplyMemoryInput, MutationResult, 'apply'>
  >();
  expectTypeOf(createMemoryConfigureDefinition()).toEqualTypeOf<
    MemoryDefinition<ConfigureMemoryInput, MutationResult, 'configure'>
  >();
  expectTypeOf(createMemoryReadContextDefinition()).toEqualTypeOf<
    MemoryDefinition<ReadContextInput, ReadContextResult | undefined, 'readContext'>
  >();
  expectTypeOf(createMemoryInspectVersionDefinition()).toEqualTypeOf<
    MemoryDefinition<
      MemoryVersionReference,
      MemorySnapshot | undefined,
      'inspectVersion',
      MemoryHistoryOperations
    >
  >();
  expectTypeOf(createMemoryListVersionsDefinition()).toEqualTypeOf<
    MemoryDefinition<
      ListMemoryVersionsInput,
      MemoryHistoryPage | undefined,
      'listVersions',
      MemoryHistoryOperations
    >
  >();
  expectTypeOf(createMemoryForkDefinition()).toEqualTypeOf<
    MemoryDefinition<ForkMemoryInput, MutationResult, 'fork', MemoryHistoryOperations>
  >();
  expectTypeOf(createMemoryReadVersionContextDefinition()).toEqualTypeOf<
    MemoryDefinition<
      ReadMemoryVersionContextInput,
      ReadContextResult | undefined,
      'readVersionContext',
      VersionedMemoryOperations
    >
  >();
});
