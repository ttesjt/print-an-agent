import type { ActorEngineId } from '../identifiers.js';
import type {
  ActorEngineCapabilitiesInput,
  ActorEngineCapabilities,
} from '../capabilities/index.js';
import type { ActorEngineHandlers } from './invocation.js';
import type { TokenCounter, TextTokenInput } from '../../token-measurement/index.js';

export interface ActorEngineInput extends ActorEngineHandlers {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: string;
  readonly capabilities: ActorEngineCapabilitiesInput;
}

export interface ActorEngine extends ActorEngineHandlers {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: ActorEngineId;
  readonly capabilities: ActorEngineCapabilities;
}
