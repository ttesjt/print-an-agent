import { AgentSessionError } from '../errors.js';

export class SessionNavigationStepNotImplementedError extends AgentSessionError {
  readonly stepName: string;

  constructor(stepName: string) {
    super(
      'SESSION_NAVIGATION_NOT_CONFIGURED',
      `Session navigation step "${stepName}" requires an explicit implementation.`
    );
    this.name = 'SessionNavigationStepNotImplementedError';
    this.stepName = stepName;
  }
}
