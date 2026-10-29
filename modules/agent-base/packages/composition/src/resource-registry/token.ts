import { ResourceError } from './errors.js';
import { assertName, assertWiringRecord, snapshotJson } from './json.js';

export interface ResourceTokenIdentity {
  readonly name: string;
}

/** Binding and value parameters are invariant; names are diagnostic, never lookup identity. */
export class ResourceToken<TBinding, TValue> implements ResourceTokenIdentity {
  declare private readonly invariant: (
    binding: TBinding,
    value: TValue
  ) => readonly [TBinding, TValue];

  constructor(
    readonly name: string,
    readonly contract: Readonly<{
      parseBinding: (input: unknown) => TBinding;
      isValue: (value: unknown, binding: TBinding) => value is TValue;
    }>
  ) {
    assertName(name);
    assertWiringRecord(contract, ['parseBinding', 'isValue']);
    if (typeof contract.parseBinding !== 'function' || typeof contract.isValue !== 'function') {
      throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A resource contract is invalid.');
    }
    this.contract = Object.freeze({ ...contract });
    Object.freeze(this);
  }

  parse(input: unknown): TBinding {
    try {
      return snapshotJson(this.contract.parseBinding(snapshotJson(input)));
    } catch (cause) {
      if (cause instanceof ResourceError) throw cause;
      throw new ResourceError('RESOURCE_BINDING_CONFLICT', 'A resource binding is invalid.', {
        cause,
      });
    }
  }

  accept(value: unknown, binding: TBinding): TValue {
    try {
      if (value === undefined || isThenable(value) || !this.contract.isValue(value, binding)) {
        throw new ResourceError(
          'RESOURCE_INITIALIZATION_FAILED',
          'A resource does not satisfy its contract.'
        );
      }
      return value;
    } catch (cause) {
      if (cause instanceof ResourceError) throw cause;
      throw new ResourceError(
        'RESOURCE_INITIALIZATION_FAILED',
        'A resource contract check failed.',
        { cause }
      );
    }
  }

  request(binding: TBinding): ResourceRequest<TBinding, TValue> {
    return Object.freeze({ token: this, binding: snapshotJson(binding) });
  }
}

/** Returning a thenable through an async resolver would execute/unwrap it, not return a capability. */
export function isThenable(value: unknown): boolean {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

export interface ResourceRequest<TBinding, TValue> {
  readonly token: ResourceToken<TBinding, TValue>;
  readonly binding: TBinding;
}
