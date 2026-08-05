import type { PackageOptions } from '../types/package-options.js';

export function definePackage(options: PackageOptions): Readonly<PackageOptions> {
  return Object.freeze({ ...options });
}
