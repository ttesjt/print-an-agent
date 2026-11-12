import type { ProfileId } from '@print-an-agent/workbench-domain';

import type {
  ProfilePersistence,
  ProfilePersistenceAdapter,
  ProfilePersistenceScope,
} from '../../ports/profile-persistence-adapter.js';
import { createMemoryPersistence } from './create-memory-persistence.js';

/** Creates one isolated in-memory persistence composition per Profile. */
export function createMemoryProfilePersistenceAdapter(): ProfilePersistenceAdapter {
  const persistenceByProfile = new Map<ProfileId, ProfilePersistence>();

  return Object.freeze({
    forProfile: ({ profileId }: ProfilePersistenceScope) => {
      let persistence = persistenceByProfile.get(profileId);
      if (persistence === undefined) {
        persistence = createMemoryPersistence({ profileId });
        persistenceByProfile.set(profileId, persistence);
      }
      return Promise.resolve(persistence);
    },
  });
}
