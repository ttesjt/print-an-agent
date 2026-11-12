import type { CollectionChoice } from '@print-an-agent/ui-contracts';
import { array, literal, object, optional, text, union } from '../transport/decoder.js';

/** Concrete Agent Web locator. The reusable UI contract knows nothing about directories. */
export type DirectoryCollectionReference = Readonly<{ rootDirectory: string }>;
export type DirectoryCollectionChoice = CollectionChoice<DirectoryCollectionReference>;
export const directoryReference = object({ rootDirectory: text(4096, 1) });
export const directoryChoice = object({
  key: text(256, 1),
  label: text(256, 1),
  description: optional(text(4096)),
  reference: directoryReference,
});
export const directoryOpenReceipt = union(
  object({ ok: literal(true), collection: directoryChoice }),
  object({ ok: literal(false), message: text(1024, 1) })
);
export const collectionBootstrap = object({ initialCollection: optional(directoryChoice) });
export const directoryListing = object({
  rootDirectory: text(4096, 1),
  parentDirectory: optional(text(4096, 1)),
  directories: array(object({ label: text(256, 1), rootDirectory: text(4096, 1) }), 200),
});
export type DirectoryListing = ReturnType<typeof directoryListing.decode>;
