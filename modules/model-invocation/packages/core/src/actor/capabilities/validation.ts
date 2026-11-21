import { assertActorRecordKeys } from '../record-validation.js';
import { ActorError } from '../errors.js';

export const CAPABILITY_KEYS = Object.freeze([
  'invocationModes',
  'inputMediaTypes',
  'interaction',
  'toolCalling',
  'structuredOutput',
  'cancellation',
  'maxContextTokens',
]);

export const INTERACTION_CAPABILITY_KEYS = Object.freeze(['streamable']);

export function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  assertActorRecordKeys(value, allowed, label, 'ACTOR_CAPABILITIES_INVALID');
}

export function parseUniqueValues<T extends string>(
  values: unknown,
  allowed: readonly T[],
  label: string,
  allowEmpty: boolean
): readonly T[] {
  if (
    !Array.isArray(values) ||
    (!allowEmpty && values.length === 0) ||
    values.some((value) => typeof value !== 'string' || !allowed.includes(value as T)) ||
    new Set(values).size !== values.length
  ) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      `${label} must contain unique supported values${allowEmpty ? '' : ' and cannot be empty'}.`
    );
  }
  return Object.freeze(Array.from(values as readonly unknown[], (value) => value as T));
}

export function parseOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      `${label} must be a positive safe integer when provided.`
    );
  }
  return value as number;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ActorError('ACTOR_CAPABILITIES_INVALID', `${label} must be a boolean.`);
  }
  return value;
}

export function parseOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requireBoolean(value, label);
}
