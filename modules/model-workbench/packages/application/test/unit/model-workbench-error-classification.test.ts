import { describe, expect, it } from 'vitest';

import { WorkbenchControlPlaneError } from '@print-an-agent/workbench-control-plane';
import { InvalidWorkbenchValueError } from '@print-an-agent/workbench-domain';
import { WorkbenchExtensionError } from '@print-an-agent/workbench-extension';
import { PersistenceDataCorruptionError } from '@print-an-agent/workbench-persistence';
import { WorkbenchSetupError } from '@print-an-agent/workbench-setup';

import { ModelWorkbenchErrorCategory, classifyModelWorkbenchError } from '../../src/index.js';

const ControlPlaneErrorCodesByCategory = [
  {
    category: ModelWorkbenchErrorCategory.InvalidRequestOrConfiguration,
    codes: ['DISCOVERY_FILTER_INVALID', 'DISCOVERY_PAGE_INVALID'],
  },
  {
    category: ModelWorkbenchErrorCategory.TargetNotCallable,
    codes: [
      'ARTIFACT_HANDOFF_SUPPORT_NOT_FOUND',
      'CANONICAL_OUTPUT_INVOKER_AMBIGUOUS',
      'CANONICAL_OUTPUT_INVOKER_UNAVAILABLE',
      'EXPORTER_SLOT_NOT_FOUND',
      'INITIALIZER_SLOT_NOT_FOUND',
      'MODEL_OUTPUT_NOT_FOUND',
      'MODEL_PROFILE_NOT_FOUND',
      'MODEL_RUN_NOT_FOUND',
      'MODEL_RUN_OPERATION_UNAVAILABLE',
      'MODEL_STATE_ASSET_NOT_FOUND',
      'OUTPUT_INVOCATION_ARTIFACT_SUPPORT_NOT_FOUND',
      'OUTPUT_INVOCATION_ARTIFACT_VERIFICATION_FAILED',
      'OUTPUT_INVOKER_SLOT_NOT_FOUND',
      'TRAINER_SLOT_NOT_FOUND',
    ],
  },
  {
    category: ModelWorkbenchErrorCategory.OperationFailure,
    codes: [
      'EXPORT_ARTIFACT_VERIFICATION_ERROR',
      'EXPORT_CAPABILITY_ERROR',
      'INITIALIZATION_ARTIFACT_VERIFICATION_ERROR',
      'INITIALIZATION_CAPABILITY_ERROR',
      'MODEL_STATE_ARTIFACT_MATERIALIZATION_FAILED',
      'RUN_CANCELLATION_ERROR',
      'RUN_OBSERVATION_ERROR',
      'TRAINING_ARTIFACT_VERIFICATION_ERROR',
      'TRAINING_CAPABILITY_ERROR',
    ],
  },
  {
    category: ModelWorkbenchErrorCategory.InvocationFailure,
    codes: [
      'OUTPUT_INVOCATION_ARTIFACT_MATERIALIZATION_FAILED',
      'OUTPUT_INVOCATION_CAPABILITY_FAILED',
    ],
  },
  {
    category: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
    codes: [
      'DISCOVERY_PERSISTENCE_INVALID',
      'DISCOVERY_RECORD_MISMATCH',
      'MODEL_OUTPUT_MISMATCH',
      'MODEL_OUTPUT_PROFILE_MISMATCH',
      'MODEL_STATE_ASSET_MISMATCH',
      'MODEL_STATE_ASSET_PROFILE_MISMATCH',
      'RUN_EXECUTION_SUPPORT_MISMATCH',
    ],
  },
] as const;

describe('Model Workbench application error classification', () => {
  it.each(ControlPlaneErrorCodesByCategory)(
    'classifies current Control Plane errors as $category',
    ({ category, codes }) => {
      for (const code of codes) {
        const error = new WorkbenchControlPlaneError(code, 'fixture failure');
        expect(classifyModelWorkbenchError(error)).toEqual({ category, code });
      }
    }
  );

  it.each([
    new WorkbenchSetupError('setup.profiles', 'must be an array'),
    new InvalidWorkbenchValueError('request.profileId', 'must not be empty'),
    new WorkbenchExtensionError('capability.input', 'must be a contract'),
  ])('classifies Workbench input and configuration errors by identity', (error) => {
    expect(classifyModelWorkbenchError(error)).toEqual({
      category: ModelWorkbenchErrorCategory.InvalidRequestOrConfiguration,
      code: error.code,
    });
  });

  it('classifies persistence and integrity failures separately', () => {
    const error = new PersistenceDataCorruptionError('output', 'output:corrupt');
    expect(classifyModelWorkbenchError(error)).toEqual({
      category: ModelWorkbenchErrorCategory.PersistenceOrIntegrityFailure,
      code: error.code,
    });
  });

  it('classifies caller cancellation without inventing an error code', () => {
    const error = new Error('cancelled');
    error.name = 'AbortError';

    expect(classifyModelWorkbenchError(error)).toEqual({
      category: ModelWorkbenchErrorCategory.Cancellation,
    });
  });

  it('preserves the code of a future Workbench Control Plane error', () => {
    const error = new WorkbenchControlPlaneError('FUTURE_CONTROL_PLANE_FAILURE', 'future failure');

    expect(classifyModelWorkbenchError(error)).toEqual({
      category: ModelWorkbenchErrorCategory.UnexpectedFailure,
      code: error.code,
    });
  });

  it('does not trust a foreign error that copies a known Workbench code', () => {
    const error = Object.assign(new Error('foreign'), { code: 'MODEL_OUTPUT_NOT_FOUND' });

    expect(classifyModelWorkbenchError(error)).toEqual({
      category: ModelWorkbenchErrorCategory.UnexpectedFailure,
    });
  });
});
