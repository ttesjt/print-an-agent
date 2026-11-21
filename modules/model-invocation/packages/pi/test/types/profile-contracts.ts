import type {
  ActorEngine,
  ModelInteractionRuntime,
  ProviderModelReference,
} from '@print-an-agent/model-invocation-core';
import {
  createPiFauxRuntime,
  createPiProviderRuntime,
  definePiProviderConfig,
  type PiProviderConfigInput,
  type PiProviderRuntimeInspection,
  type PiFauxRuntimeProfile,
  type PiProviderRuntimeProfile,
} from '@print-an-agent/model-invocation-pi';

const provider = {
  kind: 'openai-compatible',
  reference: { provider: 'endpoint', model: 'text', baseUrl: 'https://example.invalid/v1' },
  contextWindowTokens: 4096,
  maxOutputTokens: 256,
  supportsReasoning: false,
  compatibility: { supportsDeveloperRole: false },
} satisfies PiProviderConfigInput;
const config = definePiProviderConfig(provider);
if (config.kind === 'openai-compatible') {
  const baseUrl: string = config.reference.baseUrl;
  const developerRole: boolean = config.compatibility.supportsDeveloperRole;
  void [baseUrl, developerRole];
}
const profiles: readonly (PiFauxRuntimeProfile | PiProviderRuntimeProfile)[] = [
  createPiFauxRuntime({ responses: [{ status: 'success', text: 'ok' }] }),
  createPiProviderRuntime({ provider }),
];
for (const profile of profiles) {
  const runtime: ModelInteractionRuntime = profile.runtime;
  const engine: ActorEngine = profile.actorEngine;
  const reference: ProviderModelReference = profile.modelReference;
  void [runtime, engine, reference];
}
function inspectionContract(inspection: PiProviderRuntimeInspection): void {
  if (inspection.kind === 'openai-compatible') {
    const supportsDeveloperRole: boolean = inspection.compatibility.supportsDeveloperRole;
    void supportsDeveloperRole;
  } else {
    // @ts-expect-error Builtin inspection does not invent compatible-endpoint configuration.
    void inspection.compatibility;
  }
  // @ts-expect-error Inspection does not expose a credential reference.
  void inspection.credentialRef;
  // @ts-expect-error Inspection does not expose a resolved API key.
  void inspection.apiKey;
}
void inspectionContract;
