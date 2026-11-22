import { createHash } from 'node:crypto';
import { canonicalJson, jsonValue } from './validation.js';

export function digestValue(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJson(jsonValue(value)))
    .digest('hex')}`;
}

export function equalValue(a: unknown, b: unknown): boolean {
  return canonicalJson(jsonValue(a)) === canonicalJson(jsonValue(b));
}
