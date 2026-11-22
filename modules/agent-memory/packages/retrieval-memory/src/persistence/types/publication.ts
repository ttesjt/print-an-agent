import type { RetrievalPublication, RetrievalReceipt } from '../../types/publication.js';

export type PreparedMutation =
  | { readonly receipt: RetrievalReceipt }
  | { readonly publication: RetrievalPublication };
