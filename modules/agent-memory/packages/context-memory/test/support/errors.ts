import { ContextMemoryError } from '@print-an-agent/context-memory';

export function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ContextMemoryError) return error.code;
    throw error;
  }
  throw new Error('Expected a ContextMemoryError.');
}
