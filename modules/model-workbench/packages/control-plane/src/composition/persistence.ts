import type {
  InitializationCommitter,
  ParameterRepository,
  RunRepository,
  TrainingCommitter,
} from '@ta-agent/workbench-persistence';

/**
 * Composition shape for the narrow persistence ports consumed by the control plane.
 *
 * This is not an adapter contract: each port may be supplied by a different implementation.
 */
export interface ControlPlanePersistence {
  readonly runs: RunRepository;
  readonly parameters: ParameterRepository;
  readonly commits: {
    readonly initialization: InitializationCommitter;
    readonly training: TrainingCommitter;
  };
}
