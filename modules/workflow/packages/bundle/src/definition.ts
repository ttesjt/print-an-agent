import type { BundleWorkflowDefinition } from './types.js';
import { WorkflowBundleDefinitionError, type WorkflowBundleDefinitionErrorCode } from './errors.js';

type RecordValue = Readonly<Record<string, unknown>>;

export function readRecord(
  value: unknown,
  code: WorkflowBundleDefinitionErrorCode,
  allowed?: readonly string[],
  memberName?: string
): RecordValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new WorkflowBundleDefinitionError(
      code,
      'Bundle configuration must be a plain record.',
      memberName
    );
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      key.trim() === '' ||
      (allowed !== undefined && !allowed.includes(key)) ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new WorkflowBundleDefinitionError(
        code,
        'Bundle configuration contains an unsupported field or accessor.',
        memberName
      );
    }
    snapshot[key] = descriptor.value as unknown;
  }
  return Object.freeze(snapshot);
}

const MEMBER_FIELDS = [
  'name',
  'entryStep',
  'stepDefinitions',
  'stepOverrides',
  'createState',
  'createResult',
  'createSkippedResult',
  'condition',
  'lifecycle',
  'executeStep',
  'createRunId',
];

/** Runtime shape validation cannot inspect the business types of consumer-authored callbacks. */
export function readMember(
  value: unknown,
  memberName: string
): BundleWorkflowDefinition<string, unknown, unknown, unknown, unknown> {
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'resources')) {
    throw new WorkflowBundleDefinitionError(
      'WORKFLOW_BUNDLE_RESOURCE_BINDING_FORBIDDEN',
      'Bundle members cannot supply their own resource binding.',
      memberName
    );
  }
  const code = 'WORKFLOW_BUNDLE_MEMBER_INVALID';
  const definition = readRecord(value, code, MEMBER_FIELDS, memberName);
  if (
    typeof definition.name !== 'string' ||
    typeof definition.entryStep !== 'string' ||
    typeof definition.createState !== 'function' ||
    typeof definition.createResult !== 'function' ||
    !Object.hasOwn(definition, 'stepDefinitions') ||
    ['createSkippedResult', 'condition', 'executeStep', 'createRunId'].some(
      (key) => definition[key] !== undefined && typeof definition[key] !== 'function'
    )
  ) {
    throw new WorkflowBundleDefinitionError(
      code,
      'Bundle member requires a complete unbound Workflow definition.',
      memberName
    );
  }
  if (definition.lifecycle !== undefined) {
    const lifecycle = readRecord(
      definition.lifecycle,
      code,
      ['onSuccess', 'onError', 'onFinally'],
      memberName
    );
    if (Object.values(lifecycle).some((hook) => hook !== undefined && typeof hook !== 'function')) {
      throw new WorkflowBundleDefinitionError(
        code,
        'Workflow lifecycle hooks must be functions.',
        memberName
      );
    }
  }
  // The constructor checks each member's types against its Resources. Only this private
  // heterogeneous assembly boundary erases callback types; execution remains entirely in Core.
  return definition as BundleWorkflowDefinition<string, unknown, unknown, unknown, unknown>;
}
