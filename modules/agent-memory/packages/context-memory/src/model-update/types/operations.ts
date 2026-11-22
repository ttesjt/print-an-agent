export type ModelEditOperation =
  | { readonly op: 'add'; readonly content: string }
  | { readonly op: 'replace'; readonly itemId: string; readonly content: string }
  | { readonly op: 'remove'; readonly itemId: string };
