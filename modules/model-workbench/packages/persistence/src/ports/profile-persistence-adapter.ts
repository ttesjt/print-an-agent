import type { JsonObject, ProfileId } from '@print-an-agent/workbench-domain';

import type { ExportCommitter } from './export-committer.js';
import type { InitializationCommitter } from './initialization-committer.js';
import type { OutputRepository } from './output-repository.js';
import type { ParameterRepository } from './parameter-repository.js';
import type { RunRepository } from './run-repository.js';
import type { TrainingCommitter } from './training-committer.js';

/** Narrow persistence ports used together within one Profile infrastructure scope. */
export interface ProfilePersistence {
  readonly runs: RunRepository;
  readonly parameters: ParameterRepository;
  readonly outputs: OutputRepository;
  readonly commits: {
    readonly initialization: InitializationCommitter;
    readonly training: TrainingCommitter;
    readonly export: ExportCommitter;
  };
}

/** Static routing context supplied to a persistence adapter for one Profile. */
export interface ProfilePersistenceScope {
  readonly profileId: ProfileId;
  readonly configuration?: JsonObject;
}

/** Resolves the persistence composition owned by one Profile. */
export interface ProfilePersistenceAdapter {
  forProfile(scope: ProfilePersistenceScope): Promise<ProfilePersistence>;
}
