import {
  InvalidWorkbenchValueError,
  parseJsonValue,
  type JsonValue,
} from '@ta-agent/workbench-domain';

import { WorkbenchExtensionError } from './errors.js';

export function invalidExtension(path: string, reason: string, options?: ErrorOptions): never {
  throw new WorkbenchExtensionError(path, reason, options);
}

export function parseDomainValue<T>(parser: () => T, path: string): T {
  try {
    return parser();
  } catch (error: unknown) {
    if (error instanceof InvalidWorkbenchValueError) {
      return invalidExtension(path, error.reason, { cause: error });
    }
    throw error;
  }
}

export function parseExtensionMetadata(input: unknown, path: string): JsonValue | undefined {
  return input === undefined
    ? undefined
    : parseDomainValue(() => parseJsonValue(input, path), path);
}
