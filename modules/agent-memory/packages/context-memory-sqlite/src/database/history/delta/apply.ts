import { jsonValue } from '@print-an-agent/context-memory';
import type { JsonValue } from '@print-an-agent/context-memory';
import type { Path } from './types.js';
import { array, object } from './values.js';

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
