export type Primitive = string | number | boolean | null;

export type MetadataFilter =
  | { readonly op: 'eq'; readonly path: readonly string[]; readonly value: Primitive }
  | { readonly op: 'in'; readonly path: readonly string[]; readonly values: readonly Primitive[] }
  | { readonly op: 'exists'; readonly path: readonly string[]; readonly value: boolean }
  | { readonly op: 'and'; readonly filters: readonly MetadataFilter[] };
