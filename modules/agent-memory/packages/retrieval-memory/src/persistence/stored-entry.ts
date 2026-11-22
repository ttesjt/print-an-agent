import type { StoredEntry } from '../types/entry.js';
import type { RetrievalSpace } from '../types/space.js';
import { exact, record } from '../values/index.js';
import { fail } from '../errors.js';
import { parseRetrievalEntry } from '../content/index.js';
import { validateRepresentation, parseRepresentation } from '../representation/index.js';

export function parseStoredEntry(value: unknown, space: RetrievalSpace): StoredEntry {
  const data = record(value);
  exact(data, ['entry', 'representation']);
  const entry = parseRetrievalEntry(data.entry);
  if (entry.memoryId !== space.memoryId)
    fail('REPRESENTATION_INVALID', 'Stored Entry scope mismatch.');
  // Validate the structural record before using the typed representation's numerical guard.
  const representation = parseRepresentation(data.representation);
  return { entry, representation: validateRepresentation(representation, entry, space) };
}
