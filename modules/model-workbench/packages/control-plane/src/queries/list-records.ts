import type { PersistencePage } from '@print-an-agent/workbench-persistence';

import { WorkbenchControlPlaneError } from '../foundation/errors.js';

export const DEFAULT_DISCOVERY_PAGE_SIZE = 50;
export const MAXIMUM_DISCOVERY_PAGE_SIZE = 100;

export interface DiscoveryPage<TRecord> {
  readonly records: readonly TRecord[];
  readonly nextCursor?: string;
}

export async function listMatchingRecords<TIdentity, TRecord>(options: {
  readonly after?: TIdentity;
  readonly limit?: number;
  readonly load: (
    request: Readonly<{ after?: TIdentity; limit: number }>
  ) => Promise<PersistencePage<TRecord>>;
  readonly identity: (record: TRecord) => TIdentity;
  readonly validate?: (record: TRecord) => void;
  readonly matches?: (record: TRecord) => boolean;
}): Promise<DiscoveryPage<TRecord>> {
  const limit = parseDiscoveryLimit(options.limit);
  const records: TRecord[] = [];
  let after = options.after;

  while (records.length < limit) {
    const page = await options.load({
      ...(after === undefined ? {} : { after }),
      limit: MAXIMUM_DISCOVERY_PAGE_SIZE,
    });
    if (page.records.length > MAXIMUM_DISCOVERY_PAGE_SIZE) invalidPersistencePage();
    if (page.records.length === 0) {
      if (page.hasMore) invalidPersistencePage();
      return freezePage(records);
    }

    for (let index = 0; index < page.records.length; index += 1) {
      const record = page.records[index];
      if (record === undefined) continue;
      options.validate?.(record);
      const identity = options.identity(record);
      if (after !== undefined && String(identity) <= String(after)) invalidPersistencePage();
      after = identity;
      if (options.matches?.(record) !== false) records.push(record);
      if (records.length === limit) {
        const hasMore = index < page.records.length - 1 || page.hasMore;
        return freezePage(records, hasMore ? String(after) : undefined);
      }
    }

    if (!page.hasMore) return freezePage(records);
  }

  return freezePage(records, after === undefined ? undefined : String(after));
}

function invalidPersistencePage(): never {
  throw new WorkbenchControlPlaneError(
    'DISCOVERY_PERSISTENCE_INVALID',
    'Persistence returned an invalid or unstable discovery page.'
  );
}

function parseDiscoveryLimit(input: number | undefined): number {
  const value = input ?? DEFAULT_DISCOVERY_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_DISCOVERY_PAGE_SIZE) {
    throw new WorkbenchControlPlaneError(
      'DISCOVERY_PAGE_INVALID',
      `Discovery limit must be an integer from 1 through ${String(MAXIMUM_DISCOVERY_PAGE_SIZE)}.`
    );
  }
  return value;
}

function freezePage<TRecord>(
  records: readonly TRecord[],
  nextCursor?: string
): DiscoveryPage<TRecord> {
  return Object.freeze({
    records: Object.freeze([...records]),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
}
