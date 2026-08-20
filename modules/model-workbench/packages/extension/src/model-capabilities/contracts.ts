import type { ExporterCapabilityRuntime } from './exporter/define-exporter-capability.js';
import type { InitializerCapabilityRuntime } from './initializer/define-initializer-capability.js';
import type { OutputInvokerCapabilityRuntime } from './output-invoker/define-output-invoker-capability.js';
import type { TrainerCapabilityRuntime } from './trainer/define-trainer-capability.js';

export type ModelCapabilityRuntime =
  | InitializerCapabilityRuntime
  | TrainerCapabilityRuntime
  | ExporterCapabilityRuntime
  | OutputInvokerCapabilityRuntime;
