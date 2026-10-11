import {
  readWorkspaceLocation,
  workspaceHash,
  type WorkspaceLocation,
} from '../application/workspace-location.js';

export type CollectionLocation =
  | { readonly route: 'collections' }
  | {
      readonly route: 'workspace';
      readonly collectionKey: string;
      readonly workspace: WorkspaceLocation;
    };

export function readCollectionLocation(hash: string): CollectionLocation {
  if (hash === '' || hash === '#collections') return { route: 'collections' };
  const fields = new URLSearchParams(hash.replace(/^#/u, ''));
  const key = fields.get('collection');
  if (
    key === null ||
    key.length === 0 ||
    key.length > 256 ||
    fields.getAll('collection').length !== 1
  )
    throw new Error('Invalid Collection location.');
  fields.delete('collection');
  return {
    route: 'workspace',
    collectionKey: key,
    workspace: readWorkspaceLocation(fields.toString()),
  };
}

export function collectionHash(collectionKey: string, workspace: WorkspaceLocation = {}): string {
  const fields = new URLSearchParams(workspaceHash(workspace).replace(/^#/u, ''));
  fields.set('collection', collectionKey);
  return `#${fields.toString()}`;
}
