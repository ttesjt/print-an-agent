import {
  ResourceToken,
  type ResourceErrorCode,
} from '@ta-agent/base-composition/resource-registry';
import { expect } from 'vitest';

export function expectResourceError(run: () => unknown, code: ResourceErrorCode): void {
  let failed = false;
  try {
    run();
  } catch (error) {
    failed = true;
    expect(error).toMatchObject({ code });
  }
  expect(failed).toBe(true);
}

export function stringBinding(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Expected string binding.');
  return input;
}

export class Handle {
  closed = false;
  constructor(readonly id: string) {}
  close(): void {
    if (this.closed) throw new Error('Double release.');
    this.closed = true;
  }
}

export const handleToken = (name: string) =>
  new ResourceToken(name, {
    parseBinding: stringBinding,
    isValue: (value): value is Handle => value instanceof Handle,
  });

export const description = (key: string) => ({ key, descriptor: key });
