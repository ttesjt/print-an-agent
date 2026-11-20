import {
  AgentSessionError,
  parseSessionBranchId,
  parseTurnId,
  type MutatingSessionNavigationCommand,
} from '@print-an-agent/base-session';
import { memoryObject } from '../journal.js';

export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation revision.');
  return value;
}
export function command(value: unknown): MutatingSessionNavigationCommand {
  const data = memoryObject(value);
  const expectedRevision = revision(data.expectedRevision);
  if (data.operation === 'select')
    return { operation: 'select', branchId: parseSessionBranchId(data.branchId), expectedRevision };
  const target =
    data.newBranchId === undefined ? {} : { newBranchId: parseSessionBranchId(data.newBranchId) };
  if (data.operation === 'fork')
    return {
      operation: 'fork',
      sourceBranchId: parseSessionBranchId(data.sourceBranchId),
      throughTurnId: parseTurnId(data.throughTurnId),
      expectedRevision,
      ...target,
    };
  if (data.operation === 'rewind')
    return {
      operation: 'rewind',
      throughTurnId: parseTurnId(data.throughTurnId),
      expectedRevision,
      ...target,
    };
  throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation command.');
}
