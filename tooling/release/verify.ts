import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { verifyArtifacts } from './artifacts.ts';
import { packageManagerEnvironment } from './environment.ts';
import { ROOT, REGISTRY, readJson, type PreparedRelease } from './packages.ts';
import { startPackageRegistry } from './registry.ts';

const directory = resolve(ROOT, process.argv[2] ?? 'temp/npm-release');
if (process.argv.length > 3) throw new Error('Usage: pnpm release:verify [output-directory]');
const release = readJson<PreparedRelease>(join(directory, 'release.json'));
verifyArtifacts(release, directory);
const project = mkdtempSync(join(tmpdir(), 'print-an-agent-consumer-'));
const distance = relative(ROOT, project);
if (distance === '' || (!distance.startsWith('..') && !isAbsolute(distance)))
  throw new Error('Independent consumption must run outside the source workspace.');
let fixture: Awaited<ReturnType<typeof startPackageRegistry>> | undefined;

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: project, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${command} ${args[0]} exited ${code}.\n${stdout}`))
    );
  });
}

try {
  fixture = await startPackageRegistry(release, directory);
  cpSync(join(ROOT, 'tooling/release/consumer'), project, { recursive: true });
  cpSync(
    join(ROOT, 'modules/model-invocation/packages/pi/test/support/completion-server.ts'),
    join(project, 'completion-server.ts')
  );
  const devDependencies = { typescript: '5.9.3', '@types/node': '24.12.4' };
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify(
      {
        name: 'independent-print-an-agent-consumer',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(release.entries.map((name) => [name, release.version])),
        devDependencies,
      },
      null,
      2
    )
  );
  writeFileSync(
    join(project, '.npmrc'),
    `registry=${REGISTRY}\n@print-an-agent:registry=${fixture.url}/\n`
  );
  const env = packageManagerEnvironment(project);
  await run(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    env
  );
  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], env);
  const lock = readJson<{ packages: Record<string, { integrity?: string }> }>(
    join(project, 'package-lock.json')
  );
  for (const pkg of release.packages) {
    if (lock.packages[`node_modules/${pkg.name}`]?.integrity !== pkg.integrity)
      throw new Error(`Independent install used a different artifact for ${pkg.name}.`);
    const installed = readJson<{ version: string }>(
      join(project, 'node_modules', pkg.name, 'package.json')
    );
    if (installed.version !== release.version)
      throw new Error(`Incorrect installed version of ${pkg.name}.`);
  }
  await run(join(project, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], env);
  console.log(await run(process.execPath, ['--test', '--test-timeout=30000', 'smoke.ts'], env));

  const productionPaths = (await run('npm', ['ls', '--omit=dev', '--all', '--parseable'], env))
    .trim()
    .split('\n')
    .slice(1);
  const licenses = productionPaths
    .map((path) => {
      const manifest = readJson<{
        name: string;
        version: string;
        license?: string;
        repository?: unknown;
      }>(join(path, 'package.json'));
      if (manifest.license === undefined)
        throw new Error(`Missing license declaration in ${manifest.name}.`);
      return {
        name: manifest.name,
        version: manifest.version,
        license: manifest.license,
        repository: manifest.repository,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  writeFileSync(
    join(directory, 'dependency-licenses.json'),
    JSON.stringify(licenses, null, 2) + '\n'
  );
  rmSync(join(project, 'node_modules'), { recursive: true });
  const store = ['--store-dir', join(project, 'pnpm-store')];
  await run('pnpm', ['install', '--ignore-scripts', '--lockfile-only', ...store], env);
  await run('pnpm', ['install', '--ignore-scripts', '--frozen-lockfile', ...store], env);
  const pnpmLock = readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8');
  for (const pkg of release.packages) {
    if (!pnpmLock.includes(pkg.integrity))
      throw new Error(`pnpm resolved a different artifact for ${pkg.name}.`);
  }
  await run(join(project, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], env);
  console.log(await run(process.execPath, ['--test', '--test-timeout=30000', 'smoke.ts'], env));
  for (const pkg of release.packages) {
    if (!fixture.requests.has(pkg.name))
      throw new Error(`No registry resolution observed for ${pkg.name}.`);
  }
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
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `Verified ${release.packages.length} packages with npm and pnpm. License inventory: ${licenses.length}.`
  );
} finally {
  try {
    await fixture?.close();
  } finally {
    rmSync(project, { recursive: true });
  }
}
