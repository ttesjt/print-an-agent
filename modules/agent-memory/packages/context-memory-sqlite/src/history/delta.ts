import { canonicalJson, jsonValue, type JsonValue } from '@ta-agent/context-memory';

type Path = readonly (string | number)[];
export type StatePatch =
  | { readonly op: 'set'; readonly path: Path; readonly value: JsonValue }
  | { readonly op: 'remove'; readonly path: Path }
  | { readonly op: 'resize'; readonly path: Path; readonly length: number }
  | {
      readonly op: 'text';
      readonly path: Path;
      readonly start: number;
      readonly deleteCount: number;
      readonly text: string;
    };

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const array = (value: JsonValue): value is JsonValue[] => Array.isArray(value);
const object = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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

function at(value: JsonValue, key: string | number): JsonValue {
  if (
    array(value) &&
    typeof key === 'number' &&
    key >= 0 &&
    key < value.length &&
    Number.isSafeInteger(key)
  )
    return value[key]!;
  if (object(value) && typeof key === 'string' && Object.hasOwn(value, key)) return value[key]!;
  throw new Error('Invalid delta path.');
}
function put(value: JsonValue, key: string | number, next: JsonValue): void {
  if (
    array(value) &&
    typeof key === 'number' &&
    key >= 0 &&
    key <= value.length &&
    Number.isSafeInteger(key)
  ) {
    value[key] = next;
    return;
  }
  if (object(value) && typeof key === 'string') {
    // Never assign through __proto__ / inherited setters.
    Object.defineProperty(value, key, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return;
  }
  throw new Error('Invalid delta assignment.');
}
function exactKeys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unknown delta field.');
}
export function applyStateDelta(source: JsonValue, input: unknown): JsonValue {
  const patches = jsonValue(input);
  if (!array(patches)) throw new Error('Delta must be an array.');
  let result = structuredClone(source);
  for (const patch of patches) {
    if (!object(patch) || !array(patch.path!)) throw new Error('Invalid delta.');
    const path = patch.path.map((key) => {
      if (
        typeof key !== 'string' &&
        !(typeof key === 'number' && Number.isSafeInteger(key) && key >= 0)
      )
        throw new Error('Invalid delta path key.');
      return key;
    });
    const locate = (keys: Path) => keys.reduce<JsonValue>((value, key) => at(value, key), result);
    if (patch.op === 'set') {
      exactKeys(patch, ['op', 'path', 'value']);
      if (!Object.hasOwn(patch, 'value')) throw new Error('Missing delta value.');
      const value = structuredClone(patch.value!);
      if (path.length === 0) result = value;
      else put(locate(path.slice(0, -1)), path[path.length - 1]!, value);
    } else if (patch.op === 'remove') {
      exactKeys(patch, ['op', 'path']);
      const parent = locate(path.slice(0, -1));
      const key = path[path.length - 1];
      if (!object(parent) || typeof key !== 'string' || !Object.hasOwn(parent, key))
        throw new Error('Invalid delta removal.');
      Reflect.deleteProperty(parent, key);
    } else if (patch.op === 'resize') {
      exactKeys(patch, ['op', 'path', 'length']);
      const value = locate(path);
      if (
        !array(value) ||
        typeof patch.length !== 'number' ||
        !Number.isSafeInteger(patch.length) ||
        patch.length < 0 ||
        patch.length > value.length
      )
        throw new Error('Invalid delta resize.');
      value.length = patch.length;
    } else if (patch.op === 'text') {
      exactKeys(patch, ['op', 'path', 'start', 'deleteCount', 'text']);
      const value = locate(path);
      const { start, deleteCount, text } = patch;
      if (
        typeof value !== 'string' ||
        typeof start !== 'number' ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        typeof deleteCount !== 'number' ||
        !Number.isSafeInteger(deleteCount) ||
        deleteCount < 0 ||
        start + deleteCount > value.length ||
        typeof text !== 'string'
      )
        throw new Error('Invalid text delta.');
      const next = value.slice(0, start) + text + value.slice(start + deleteCount);
      if (path.length === 0) result = next;
      else put(locate(path.slice(0, -1)), path[path.length - 1]!, next);
    } else throw new Error('Unknown delta operation.');
  }
  return jsonValue(result);
}
