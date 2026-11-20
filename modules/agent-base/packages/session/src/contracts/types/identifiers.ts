declare const sessionIdBrand: unique symbol;

declare const sessionBranchIdBrand: unique symbol;

declare const turnIdBrand: unique symbol;

/** Adapter-generated opaque identity: immutable and never reassigned, including after deletion. */
export type SessionId = string & { readonly [sessionIdBrand]: 'SessionId' };

export type SessionBranchId = string & {
  readonly [sessionBranchIdBrand]: 'SessionBranchId';
};

export type TurnId = string & { readonly [turnIdBrand]: 'TurnId' };
