import { invalidTraceEvent } from '../../errors.js';
import { isTraceErrorCode } from '../error-code.js';
import type { TraceField } from './event-schema.js';

const TRACE_METADATA_STRING_MAX_LENGTH = 256;
const PROVENANCE_TYPE_MAX_LENGTH = 128;
const PROVENANCE_TYPE_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/i;

export function traceString(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > TRACE_METADATA_STRING_MAX_LENGTH
  ) {
    invalidTraceEvent(`${name} must contain 1-${TRACE_METADATA_STRING_MAX_LENGTH} characters.`);
  }
  return value;
}

function requireCount(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalidTraceEvent(`${name} must be a safe integer greater than or equal to ${minimum}.`);
  }
  return value;
}

export function traceCount(value: unknown, name: string): number {
  return requireCount(value, name, 0);
}

export function positiveTraceCount(value: unknown, name: string): number {
  return requireCount(value, name, 1);
}

export function traceBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') invalidTraceEvent(`${name} must be a boolean.`);
  return value;
}

export function traceChoice<const Choices extends readonly (string | number)[]>(
  ...choices: Choices
): TraceField<Choices[number]> {
  return (value, name) => {
    const selected = choices.find((choice) => choice === value);
    if (selected === undefined) invalidTraceEvent(`${name} is not supported.`);
    return selected;
  };
}

export function traceStructuredErrorCode(value: unknown): string {
  if (!isTraceErrorCode(value)) {
    invalidTraceEvent('Trace errorCode must be a bounded uppercase structured code.');
  }
  return value;
}

export function traceProvenanceType(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > PROVENANCE_TYPE_MAX_LENGTH ||
    !PROVENANCE_TYPE_PATTERN.test(value)
  ) {
    invalidTraceEvent(
      `Trace provenanceType must contain 1-${PROVENANCE_TYPE_MAX_LENGTH} letters, digits, dots, underscores, colons, slashes, or hyphens.`
    );
  }
  return value;
}

export const WORKFLOW_REFERENCE_FIELDS = {
  workflowName: traceString,
  workflowRunId: traceString,
};
