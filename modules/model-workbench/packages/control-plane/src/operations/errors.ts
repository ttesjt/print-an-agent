import { WorkbenchControlPlaneError } from '../foundation/errors.js';

export class ModelProfileNotFoundError extends WorkbenchControlPlaneError {
  readonly profileId: string;

  constructor(profileId: string) {
    super('MODEL_PROFILE_NOT_FOUND', `Model Profile "${profileId}" is not defined.`);
    this.profileId = profileId;
  }
}
