/** Ephemeral view state, scoped by the owning conversation entry; never Session data. */
export type ReasoningExpansionState = ReadonlyMap<string, ReadonlyMap<number, boolean>>;

export type ReasoningExpansionOwner = Readonly<{
  id: string;
  kind: 'interaction' | 'turn';
}>;

export function readReasoningExpansion(
  state: ReasoningExpansionState,
  owner: ReasoningExpansionOwner,
  modelTurnIndex: number
): boolean {
  return state.get(ownerKey(owner))?.get(modelTurnIndex) ?? false;
}

export function updateReasoningExpansion(
  state: ReasoningExpansionState,
  owner: ReasoningExpansionOwner,
  modelTurnIndex: number,
  open: boolean
): ReasoningExpansionState {
  const key = ownerKey(owner);
  const blocks = new Map(state.get(key));
  blocks.set(modelTurnIndex, open);
  const next = new Map(state);
  next.set(key, blocks);
  return next;
}

export function commitReasoningExpansion(
  state: ReasoningExpansionState,
  interactionId: string,
  turnId: string
): ReasoningExpansionState {
  const source = ownerKey({ id: interactionId, kind: 'interaction' });
  const blocks = state.get(source);
  if (blocks === undefined) return state;
  const next = new Map(state);
  next.delete(source);
  next.set(ownerKey({ id: turnId, kind: 'turn' }), blocks);
  return next;
}

function ownerKey(owner: ReasoningExpansionOwner): string {
  return `${owner.kind}:${owner.id}`;
}
