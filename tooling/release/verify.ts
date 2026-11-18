import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyArtifacts } from './artifacts.ts';
import { ROOT, readJson, type PreparedRelease } from './packages.ts';
import { startPackageRegistry } from './registry.ts';
import {
  verifyConsumerProfile,
  type ReleaseConsumerProfile,
  type ReleaseConsumerVerification,
} from './verify-consumer.ts';

const directory = resolve(ROOT, process.argv[2] ?? 'temp/npm-release');
if (process.argv.length > 3) throw new Error('Usage: pnpm release:verify [output-directory]');
const release = readJson<PreparedRelease>(join(directory, 'release.json'));
verifyArtifacts(release, directory);
const profiles: readonly ReleaseConsumerProfile[] = [
  {
    name: 'entries',
    dependencies: release.entries,
    sourceFiles: ['smoke.ts'],
    testFiles: ['smoke.ts'],
  },
  {
    name: 'all-apis',
    dependencies: release.packages.map(({ name }) => name),
    sourceFiles: ['smoke.ts', 'session-port.ts', 'session-workflows.test.ts'],
    testFiles: ['smoke.ts', 'session-workflows.test.ts'],
  },
];
const fixture = await startPackageRegistry(release, directory);
try {
  const results: ReleaseConsumerVerification[] = [];
  for (const profile of profiles) {
    console.log(`Verifying ${profile.name}: ${profile.dependencies.length} direct packages.`);
    results.push(await verifyConsumerProfile({ profile, release, registryUrl: fixture.url }));
  }
  for (const pkg of release.packages) {
    if (!fixture.requests.has(pkg.name))
      throw new Error(`No registry resolution observed for ${pkg.name}.`);
  }
  const licenses = results.at(-1)?.licenses;
  if (licenses === undefined) throw new Error('No consumer profiles verified.');
  writeFileSync(
    join(directory, 'dependency-licenses.json'),
    JSON.stringify(licenses, null, 2) + '\n'
  );
  writeFileSync(
    join(directory, 'verification.json'),
    JSON.stringify(
      {
        version: release.version,
        source: release.source,
        node: process.version,
        packages: release.packages.map(({ name, integrity }) => ({ name, integrity })),
        consumers: ['npm ci', 'pnpm install --frozen-lockfile'],
        productionDependencies: licenses.length,
        profiles: results.map(({ licenses: inventory, ...result }) => ({
          ...result,
          productionDependencies: inventory.length,
        })),
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `Verified ${release.packages.length} packages across ${profiles.length} consumer profiles with npm and pnpm. License inventory: ${licenses.length}.`
  );
} finally {
  await fixture.close();
}
