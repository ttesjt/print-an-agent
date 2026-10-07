import type {
  AgentManagementFailure,
  ConversationFailure,
  SessionManagementFailure,
} from '@ta-agent/ui-contracts';
import { WebInputError } from './config.js';

export function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'OPERATION_FAILED';
}

export async function agentFailure(
  error: unknown,
  readRevision?: () => Promise<string>
): Promise<AgentManagementFailure> {
  if (error instanceof WebInputError)
    return { code: 'validation-failed', message: error.message, fieldErrors: error.fieldErrors };
  const code = errorCode(error);
  if (code.includes('CONFLICT') && readRevision !== undefined) {
    try {
      return {
        code: 'revision-conflict',
        message: 'The Agent changed. Reload its current version.',
        currentRevision: await readRevision(),
      };
    } catch {
      /* A failed query must not fabricate current authority. */
    }
  }
  if (code === 'AGENT_ID_INVALID' || code === 'AGENT_IDENTITY_INVALID')
    return {
      code: 'validation-failed',
      message: 'Check the Agent identity.',
      fieldErrors: [{ field: 'agentId', message: 'Enter a valid Agent ID and display name.' }],
    };
  return {
    code: code.includes('ALREADY_EXISTS')
      ? 'already-exists'
      : code.includes('NOT_FOUND')
        ? 'not-found'
        : code.includes('DISABLED')
          ? 'unavailable'
          : 'operation-failed',
    message: 'The Agent operation could not be completed.',
  };
}

export async function sessionFailure(
  error: unknown,
  readRevision?: () => Promise<string>
): Promise<SessionManagementFailure> {
  const code = errorCode(error);
  if (code.includes('CONFLICT') && readRevision !== undefined) {
    try {
      return {
        code: 'revision-conflict',
        message: 'The Session changed. Reload its current version.',
        currentRevision: await readRevision(),
      };
    } catch {
      /* Do not fabricate a revision after failed reconciliation. */
    }
  }
  return {
    code: code.includes('NOT_FOUND')
      ? 'not-found'
      : code.includes('BUSY')
        ? 'session-busy'
        : code.includes('RETIRED')
          ? 'invalid-transition'
          : 'operation-failed',
    message: 'The Session operation could not be completed.',
  };
}

export function conversationFailure(error: unknown): ConversationFailure {
  const code = errorCode(error);
  return {
    code:
      code.includes('BUSY') || code.includes('CONFLICT')
        ? 'session-busy'
        : code.includes('NOT_FOUND')
          ? 'not-found'
          : code.includes('DISABLED') || code.includes('RETIRED')
            ? 'unavailable'
            : 'interaction-failed',
    message: 'The conversation operation could not be completed.',
  };
}
