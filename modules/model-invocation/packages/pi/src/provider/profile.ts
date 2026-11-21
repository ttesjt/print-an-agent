import {
  defineActorEngine,
  defineProviderTransportLivenessPolicy,
} from '@print-an-agent/model-invocation-core';
import { createPiActorEngine, PiActorRuntime } from '../execution/index.js';
import { definePiProviderConfig } from './configuration.js';
import { resolvePiModels } from './model-binding.js';
import { createInspection } from './inspection.js';
import type { PiProviderRuntimeOptions, PiProviderRuntimeProfile } from './types/profile.js';

const DEFAULT_ACTOR_ENGINE_ID = 'provider';

export function createPiProviderRuntime(
  options: PiProviderRuntimeOptions
): PiProviderRuntimeProfile {
  const config = definePiProviderConfig(options.provider);
  const transportLivenessPolicy = defineProviderTransportLivenessPolicy(
    options.transportLivenessPolicy
  );
  const { models, model } = resolvePiModels(config);
  const runtime = new PiActorRuntime({
    models,
    model,
    modelReference: config.reference,
    ...(options.credentialResolver === undefined
      ? {}
      : { credentialResolver: options.credentialResolver }),
    transportLivenessPolicy,
  });
  const baseEngine = createPiActorEngine(
    runtime,
    options.actorEngineId ?? DEFAULT_ACTOR_ENGINE_ID,
    model.contextWindow
  );
  const actorEngine =
    options.textTokenCounter === undefined
      ? baseEngine
      : defineActorEngine({ ...baseEngine, textTokenCounter: options.textTokenCounter });
  const inspection = createInspection(
    config,
    model,
    actorEngine.id,
    transportLivenessPolicy,
    actorEngine.textTokenCounter?.descriptor
  );

  return Object.freeze({
    runtime,
    modelReference: config.reference,
    actorEngine,
    inspect: () => inspection,
    checkReadiness: async (readinessOptions?: Readonly<{ signal?: AbortSignal }>) => {
      const signal = readinessOptions?.signal ?? new AbortController().signal;
      const status = await runtime.checkCredential(signal);
      return Object.freeze({ status, inspection });
    },
  });
}
