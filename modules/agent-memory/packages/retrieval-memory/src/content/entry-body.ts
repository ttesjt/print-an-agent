import type { EntryBody } from '../types/entry.js';
import { DEFAULT_RETRIEVAL_POLICY } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { exact, record, text } from '../values/index.js';
import { fail } from '../errors.js';

export function entryBody(
  value: unknown,
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY
): Required<EntryBody> {
  const input = record(value);
  const content = text(input.content, true);
  if (policy.maxEntryCodepoints !== null && [...content].length > policy.maxEntryCodepoints)
    fail('INPUT_INVALID', 'Entry exceeds the configured content limit.');
  const metadata = input.metadata === undefined ? {} : record(input.metadata);
  const source =
    input.source === undefined || input.source === null
      ? null
      : (() => {
          const source = record(input.source);
          exact(source, ['ref', 'label']);
          return {
            ref: text(source.ref, true),
            ...(source.label === undefined ? {} : { label: text(source.label) }),
          };
        })();
  return { content, metadata, source };
}
