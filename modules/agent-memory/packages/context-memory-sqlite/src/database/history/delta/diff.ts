import { canonicalJson } from '@print-an-agent/context-memory';
import type { JsonValue } from '@print-an-agent/context-memory';
import type { Path, StatePatch } from './types.js';
import { array, object } from './values.js';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Data-only differences, not business commands. Positional arrays never create sparse values. */
export function diffState(before: JsonValue, after: JsonValue, path: Path = []): StatePatch[] {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  const replacement: StatePatch = { op: 'set', path, value: after };
  let patches: StatePatch[];
  if (typeof before === 'string' && typeof after === 'string') {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (
      end < before.length - start &&
      end < after.length - start &&
      before[before.length - end - 1] === after[after.length - end - 1]
    )
      end++;
    patches = [
      {
        op: 'text',
        path,
        start,
        deleteCount: before.length - start - end,
        text: after.slice(start, after.length - end),
      },
    ];
  } else if (array(before) && array(after)) {
    patches = after.flatMap((value, index) =>
      index < before.length
        ? diffState(before[index]!, value, [...path, index])
        : [{ op: 'set' as const, path: [...path, index], value }]
    );
    if (after.length < before.length) patches.push({ op: 'resize', path, length: after.length });
  } else if (object(before) && object(after)) {
    patches = Object.keys(before)
      .filter((key) => !Object.hasOwn(after, key))
      .map((key) => ({ op: 'remove' as const, path: [...path, key] }));
    for (const [key, value] of Object.entries(after))
      patches.push(
        ...(Object.hasOwn(before, key)
          ? diffState(before[key]!, value, [...path, key])
          : [{ op: 'set' as const, path: [...path, key], value }])
      );
  } else return [replacement];
  return bytes(patches) < bytes([replacement]) ? patches : [replacement];
}
