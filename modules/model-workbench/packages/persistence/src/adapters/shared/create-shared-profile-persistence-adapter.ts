import type {
  ProfilePersistence,
  ProfilePersistenceAdapter,
} from '../../ports/profile-persistence-adapter.js';

/**
 * Adapts one persistence composition for deliberate sharing across Profiles.
 *
 * Prefer a routing adapter when Profiles require storage isolation.
 */
export function createSharedProfilePersistenceAdapter(
  persistence: ProfilePersistence
): ProfilePersistenceAdapter {
  return Object.freeze({
    forProfile: () => Promise.resolve(persistence),
  });
}
