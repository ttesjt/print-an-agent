import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { packageManagerEnvironment } from './environment.ts';
import {
  ENTRIES,
  ROOT,
  releasePackages,
  type PackageManifest,
  type PreparedRelease,
} from './packages.ts';

const destination = resolve(ROOT, process.argv[2] ?? 'temp/npm-release');
if (process.argv.length > 3) throw new Error('Usage: pnpm release:prepare [output-directory]');
const packages = releasePackages();
const version = packages[0]!.manifest.version;
for (const { manifest } of packages) {
  if (manifest.version !== version || manifest.private !== false || manifest.license !== 'MIT')
    throw new Error(`Inconsistent public release metadata in ${manifest.name}.`);
  if (manifest.peerDependencies !== undefined || manifest.optionalDependencies !== undefined)
    throw new Error(`Review additional dependency kinds in ${manifest.name}.`);
}
// Never replace a prior set of artifacts, even after a failed preparation.
mkdirSync(dirname(destination), { recursive: true });
mkdirSync(destination, { recursive: false });
const packEnvironment = packageManagerEnvironment(destination);
const source = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  dirty:
    execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '',
};
const filters = ENTRIES.flatMap((entry) => ['--filter-prod', `${entry}...`]);
execFileSync('pnpm', [...filters, 'clean'], { cwd: ROOT, stdio: 'inherit' });
execFileSync('pnpm', [...filters, 'build'], { cwd: ROOT, stdio: 'inherit' });

function copyBuild(sourceDirectory: string, targetDirectory: string): void {
  mkdirSync(targetDirectory, { recursive: true });
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const from = join(sourceDirectory, entry.name);
    const to = join(targetDirectory, entry.name);
    if (entry.isDirectory()) copyBuild(from, to);
    else if (entry.isFile() && entry.name.endsWith('.map')) continue;
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts'))) {
      writeFileSync(
        to,
        readFileSync(from, 'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gm, '')
      );
    } else throw new Error(`Review new build artifact ${from}.`);
  }
}

const release: PreparedRelease = { version, source, entries: ENTRIES, packages: [] };
for (const { directory, manifest } of packages) {
  const target = join(destination, manifest.name.split('/')[1]!);
  mkdirSync(target);
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([name, spec]) => {
      if (name.startsWith('@print-an-agent/')) return [name, version];
      if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(spec))
        throw new Error(`Release requires an explicit external version for ${name}.`);
      return [name, spec];
    })
  );
  const published: PackageManifest = {
    name: manifest.name,
    version,
    description: manifest.description,
    type: manifest.type,
    main: manifest.main,
    types: manifest.types,
    exports: manifest.exports,
    files: [...manifest.files],
    license: manifest.license,
    engines: manifest.engines,
    repository: manifest.repository,
    publishConfig: manifest.publishConfig,
    dependencies,
  };
  copyBuild(join(ROOT, directory, 'dist'), join(target, 'dist'));
  copyFileSync(join(ROOT, 'LICENSE'), join(target, 'LICENSE'));
  copyFileSync(join(ROOT, directory, 'README.md'), join(target, 'README.md'));
  if (manifest.name === '@print-an-agent/model-invocation-pi')
    copyFileSync(
      join(ROOT, directory, 'THIRD_PARTY_NOTICES.md'),
      join(target, 'THIRD_PARTY_NOTICES.md')
    );
  writeFileSync(join(target, 'package.json'), JSON.stringify(published, null, 2) + '\n');
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
      cwd: target,
      encoding: 'utf8',
      env: packEnvironment,
    })
  ) as { filename: string; integrity: string }[];
  const info = packed[0]!;
  const integrity = `sha512-${createHash('sha512')
    .update(readFileSync(join(destination, info.filename)))
    .digest('base64')}`;
  if (info.integrity !== integrity)
    throw new Error(`Tarball integrity mismatch for ${manifest.name}.`);
  release.packages.push({
    name: manifest.name,
    filename: info.filename,
    integrity,
    manifest: published,
  });
}
writeFileSync(join(destination, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`Prepared ${release.packages.length} public packages at ${version}: ${destination}`);
