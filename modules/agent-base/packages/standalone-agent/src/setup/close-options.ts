import { AgentBaseStandaloneError } from '../errors.js';

/** Validate before changing admission, including the no-allocation/no-owned-connection cases. */
export function setupCloseFailure(input: unknown): AgentBaseStandaloneError | undefined {
  try {
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    )
      throw new Error('Invalid close record');
    for (const key of Reflect.ownKeys(input)) {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (
        key !== 'mode' ||
        field === undefined ||
        !('value' in field) ||
        !field.enumerable ||
        (field.value !== undefined && field.value !== 'drain' && field.value !== 'abort')
      )
        throw new Error('Invalid close field');
    }
    return undefined;
  } catch (cause) {
    return new AgentBaseStandaloneError('Standalone setup close options are invalid.', { cause });
  }
}
