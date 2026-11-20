import type { SessionPresentationPort } from './types.js';

export function supportsSessionPresentation(value: object): value is SessionPresentationPort {
  return (
    'completeTurnWithPresentation' in value &&
    typeof value.completeTurnWithPresentation === 'function' &&
    'readTurnPresentation' in value &&
    typeof value.readTurnPresentation === 'function'
  );
}
