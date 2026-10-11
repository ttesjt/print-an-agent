/** A serializable, non-secret locator interpreted only by its owning application. */
export type CollectionReference =
  | string
  | number
  | boolean
  | null
  | readonly CollectionReference[]
  | { readonly [key: string]: CollectionReference };

/** key is canonical identity supplied by the resolver, not JSON serialization. */
export interface CollectionChoice<Reference extends CollectionReference = CollectionReference> {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly reference: Reference;
}

export type CollectionOpenResult<
  Connection,
  Reference extends CollectionReference = CollectionReference,
> =
  | {
      readonly ok: true;
      readonly collection: CollectionChoice<Reference>;
      readonly connection: Connection;
    }
  | { readonly ok: false; readonly message: string };

/** Resolves a locator into an application-owned connection, not Agent domain services. */
export interface CollectionAccessPort<
  Connection,
  Reference extends CollectionReference = CollectionReference,
> {
  openCollection(input: {
    readonly reference: Reference;
    readonly signal: AbortSignal;
  }): Promise<CollectionOpenResult<Connection, Reference>>;
}
