import type { RetrievalPublication } from '../contracts/publication.js';
import { parseMutation, entryBody } from './input.js';
import { RETRIEVAL_PROTOCOL_POLICY } from '../config.js';
import { equal, identifier, integer, record } from './json.js';
import { parseRetrievalEntry, parseRetrievalSpace, validateRepresentation } from './state.js';
import { fail } from '../errors.js';
export function validatePublication(value: RetrievalPublication): RetrievalPublication {
  record(value);
  const mutation = parseMutation(
    value.mutation.operation,
    value.mutation.input,
    RETRIEVAL_PROTOCOL_POLICY
  );
  const space = parseRetrievalSpace(value.space);
  if (space.memoryId !== mutation.input.memoryId)
    fail('REPRESENTATION_INVALID', 'Publication scope mismatch.');
  const expected =
    value.expected === null
      ? null
      : {
          revision: integer(value.expected.revision),
          representationId: identifier(value.expected.representationId),
        };
  const entry = value.entry === null ? null : parseRetrievalEntry(value.entry);
  if (entry !== null && entry.memoryId !== space.memoryId)
    fail('REPRESENTATION_INVALID', 'Entry scope mismatch.');
  const representation =
    value.representation === null
      ? null
      : entry === null
        ? fail('REPRESENTATION_INVALID', 'Representation requires an Entry.')
        : validateRepresentation(value.representation, entry, space);
  if (mutation.operation === 'create') {
    if (
      entry !== null ||
      representation !== null ||
      expected !== null ||
      space.revision !== 1 ||
      space.sequence !== 0 ||
      !equal(mutation.input.index, {
        embeddingRef: space.index.embeddingRef,
        chunkerRef: space.index.chunkerRef,
        metricRef: space.index.metricRef,
      })
    )
      fail('REPRESENTATION_INVALID', 'Invalid Space creation candidate.');
  } else if (mutation.operation === 'remove') {
    if (entry !== null || representation !== null || expected === null)
      fail('REPRESENTATION_INVALID', 'Invalid removal candidate.');
  } else {
    if (entry === null || representation === null)
      fail('REPRESENTATION_INVALID', 'Entry and representation are required.');
    if (mutation.operation === 'ingest' || mutation.operation === 'update') {
      if (
        !equal(
          entryBody(entry, RETRIEVAL_PROTOCOL_POLICY),
          entryBody(mutation.input, RETRIEVAL_PROTOCOL_POLICY)
        )
      )
        fail('REPRESENTATION_INVALID', 'Candidate does not represent the requested content.');
    }
  }
  if (
    mutation.operation !== 'create' &&
    mutation.operation !== 'ingest' &&
    (expected === null ||
      expected.revision !== mutation.input.expectedRevision ||
      (entry !== null && entry.entryId !== mutation.input.entryId))
  )
    fail('REPRESENTATION_INVALID', 'Entry precondition mismatch.');
  return { mutation, space, expected, entry, representation };
}
