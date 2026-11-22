import { integer } from './validation.js';

export function nullableInteger(value: unknown, name: string, minimum = 1): number | null {
  return value === null ? null : integer(value, name, minimum, 'CONFIG_INVALID');
}
