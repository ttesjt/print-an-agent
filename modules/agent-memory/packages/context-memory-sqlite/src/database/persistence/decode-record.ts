import { ContextMemoryError } from '@print-an-agent/context-memory';

export function storedRecord<T>(memoryId: string, read: () => T): T {
  try {
    return read();
  } catch (cause) {
    throw new ContextMemoryError(
      'STORAGE_FAILED',
      'Stored memory authority could not be decoded.',
      {
        memoryId,
        cause,
      }
    );
  }
}
