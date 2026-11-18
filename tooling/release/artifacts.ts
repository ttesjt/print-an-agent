import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  ENTRIES,
  PACKAGE_DIRECTORIES,
  REGISTRY,
  REPOSITORY,
  ROOT,
  type PackageManifest,
  type PreparedRelease,
} from './packages.ts';

export function verifyArtifacts(release: PreparedRelease, directory: string): void {
  const expected = Object.keys(PACKAGE_DIRECTORIES).sort();
  if (
    !isDeepStrictEqual(release.entries, ENTRIES) ||
    !isDeepStrictEqual(release.packages.map((pkg) => pkg.name).sort(), expected)
  )
    throw new Error('Prepared release has an unexpected package scope.');
  for (const pkg of release.packages) {
    if (!/^[a-z0-9.-]+\.tgz$/.test(pkg.filename)) throw new Error('Invalid tarball filename.');
    const tarball = join(directory, pkg.filename);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (integrity !== pkg.integrity) throw new Error(`Tarball changed: ${pkg.name}.`);
    const contents = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      .trim()
      .split('\n');
    const read = (file: string) =>
      execFileSync('tar', ['-xOf', tarball, `package/${file}`], { encoding: 'utf8' });
    const manifest = JSON.parse(read('package.json')) as PackageManifest;
    if (
      !isDeepStrictEqual(manifest, pkg.manifest) ||
      manifest.version !== release.version ||
      manifest.name !== pkg.name
    )
      throw new Error(`Incorrect packed manifest: ${pkg.name}.`);
    if (
      manifest.private === true ||
      manifest.license !== 'MIT' ||
      manifest.publishConfig.access !== 'public' ||
      manifest.publishConfig.registry !== REGISTRY ||
      manifest.repository.url !== `${REPOSITORY}.git`
    )
      throw new Error(`Incorrect publication metadata: ${pkg.name}.`);
    if (
      read('LICENSE') !== readFileSync(join(ROOT, 'LICENSE'), 'utf8') ||
      read('README.md').trim() === ''
    )
      throw new Error(`Missing license or package documentation: ${pkg.name}.`);
    const entryFiles = [
      manifest.main,
      manifest.types,
      ...Object.values(manifest.exports).flatMap((entry) => [entry.import, entry.types]),
    ];
    for (const entry of entryFiles) {
      if (!entry.startsWith('./dist/') || !contents.includes(`package/${entry.slice(2)}`))
        throw new Error(`Missing public export ${entry} in ${pkg.name}.`);
    }
    for (const file of contents) {
      const relative = file.replace(/^package\//, '');
      if (
        !['package.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md'].includes(relative) &&
        !/^dist\/.+\.(js|d\.ts)$/.test(relative)
      )
        throw new Error(`Unexpected packed file ${file}.`);
      if (
        relative.startsWith('dist/') &&
        /sourceMappingURL=|(?:from\s*|import\s*\(\s*)['"](?:workspace|catalog|link):/.test(
          read(relative)
        )
      )
        throw new Error(`Unresolved source map or workspace reference in ${file}.`);
    }
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (
        name.startsWith('@print-an-agent/') &&
        (!expected.includes(name) || spec !== release.version)
      )
        throw new Error(`Incorrect release dependency ${name} in ${pkg.name}.`);
      if (/^(?:workspace|catalog|file|link):/.test(spec))
        throw new Error(`Unresolved dependency ${name}.`);
    }
    if (pkg.name === '@print-an-agent/model-invocation-pi') read('THIRD_PARTY_NOTICES.md');
  }
}
