import { ContextMemoryError } from '../errors.js';

export function verifyHistoryResponse<T>(memoryId: string, parse: () => T): T {
  try {
    return parse();
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.code === 'HISTORY_CORRUPT') throw cause;
    throw new ContextMemoryError('HISTORY_CORRUPT', 'History adapter returned invalid data.', {
      memoryId,
      cause,
    });
  }
}
