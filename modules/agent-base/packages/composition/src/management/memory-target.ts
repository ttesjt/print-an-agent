/** No lossy concatenation, truncation, normalization or storage-specific paths. */
export function validateMemoryIdentifier(value: unknown, maxBytes: number | null = 1024): string {
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 1))
    throw new TypeError('Memory identity byte limit must be a positive safe integer or null.');
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    value.trim() === '' ||
    value.includes('\0') ||
    (maxBytes !== null && new TextEncoder().encode(value).length > maxBytes)
  )
    throw new TypeError(
      'Memory identity must be well-formed, nonempty Unicode within its byte limit.'
    );
  return value;
}

/** Stable profile namespace + Agent + logical document/space, never a Config revision. */
export function scopedAgentMemoryId(
  storageNamespaceId: string,
  agentId: string,
  memoryId: string,
  maxBytes: number | null = 1024
): string {
  return validateMemoryIdentifier(
    JSON.stringify([
      'agent-base-memory',
      validateMemoryIdentifier(storageNamespaceId, maxBytes),
      validateMemoryIdentifier(agentId, maxBytes),
      validateMemoryIdentifier(memoryId, maxBytes),
    ]),
    maxBytes
  );
}
