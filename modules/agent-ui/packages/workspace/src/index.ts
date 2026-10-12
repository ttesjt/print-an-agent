export { AgentWorkspace, type AgentWorkspaceProps } from './workspace.js';
export { BrowserAgentWorkspace } from './application/browser-composition.js';
export {
  CollectionApplication,
  type CollectionApplicationProps,
  type CollectionConnection,
  type CollectionBoundaryState,
} from './collection/collection-application.js';
export { useRecentCollections } from './collection/use-recent-collections.js';
export {
  readWorkspaceLocation,
  workspaceHash,
  type WorkspaceLocation,
} from './application/workspace-location.js';
export {
  collectionHash,
  readCollectionLocation,
  type CollectionLocation,
} from './collection/collection-location.js';
export type {
  WorkspaceExtension,
  WorkspaceExtensionProps,
  WorkspaceSurfaces,
  WorkspaceEditBoundary,
} from './extensions.js';
export { useRevisionedEditor, type RevisionedEditorOptions } from './use-revisioned-editor.js';
export { useWorkspaceMutation } from './use-workspace-mutation.js';
export { useWorkspaceBoundary } from './use-workspace-boundary.js';
