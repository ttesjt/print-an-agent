export const ACTOR_INVOCATION_MODES = Object.freeze(['interaction', 'direct', 'stream'] as const);

export type ActorInvocationMode = (typeof ACTOR_INVOCATION_MODES)[number];

export const ACTOR_INPUT_MEDIA_TYPES = Object.freeze(['text', 'image', 'audio', 'video'] as const);

export type ActorInputMediaType = (typeof ACTOR_INPUT_MEDIA_TYPES)[number];
