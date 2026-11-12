import type {
  AgentManagementFailure,
  ConversationFailure,
  SessionManagementFailure,
} from '@print-an-agent/ui-contracts';
import { AgentConfigValidationError } from '../../application/agent-config-validation.js';
import { WebModelError } from './model-runtime.js';

const TIMEOUT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  REQUEST_TIMEOUT: 'The configured Request deadline expired. Review execution settings or retry.',
  ACTOR_INVOCATION_TIMEOUT:
    'The Actor invocation deadline expired. Review execution settings or retry.',
  MODEL_PROVIDER_RESPONSE_START_TIMEOUT:
    'The provider did not start responding before its configured deadline.',
  MODEL_PROVIDER_STREAM_IDLE_TIMEOUT:
    'The provider stream remained idle beyond its configured deadline.',
});

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
  if (error instanceof AgentConfigValidationError)
    return { code: 'validation-failed', message: error.message, fieldErrors: error.fieldErrors };
  const code = errorCode(error);
  if (error instanceof WebModelError) return { code: 'unavailable', message: error.message };
  if (TIMEOUT_MESSAGES[code] !== undefined)
    return { code: 'operation-failed', message: TIMEOUT_MESSAGES[code] };
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
      fieldErrors: [
        {
          field: code === 'AGENT_ID_INVALID' ? 'agentId' : 'displayName',
          message: 'Enter a valid Agent ID and display name.',
        },
      ],
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
  if (error instanceof WebModelError) return { code: 'unavailable', message: error.message };
  const code = errorCode(error);
  if (TIMEOUT_MESSAGES[code] !== undefined)
    return { code: 'interaction-failed', message: TIMEOUT_MESSAGES[code] };
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
