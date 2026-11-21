import { defineSessionlessGenerationPolicy } from '@print-an-agent/base-request';

/** Consumer declaration output must name the public contract without private package paths. */
export function sessionlessPolicy() {
  return defineSessionlessGenerationPolicy();
}
