import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { packageManagerEnvironment } from './environment.ts';
import { ROOT, REGISTRY, readJson, type PreparedRelease } from './packages.ts';

export interface ReleaseConsumerProfile {
  readonly name: string;
  readonly dependencies: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
}
interface DependencyLicense {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly repository?: unknown;
}
export interface ReleaseConsumerVerification {
  readonly name: string;
  readonly directDependencies: readonly string[];
  readonly testFiles: readonly string[];
  readonly consumers: readonly string[];
  readonly licenses: readonly DependencyLicense[];
}

function run(
  project: string,
  env: NodeJS.ProcessEnv,
  command: string,
  args: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: project, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${command} ${args[0]} exited ${code}.\n${stdout}`))
    );
  });
}

/** Every profile gets a fresh project, auth-free config, cache, lockfiles and package store. */
export async function verifyConsumerProfile(options: {
  readonly profile: ReleaseConsumerProfile;
  readonly release: PreparedRelease;
  readonly registryUrl: string;
}): Promise<ReleaseConsumerVerification> {
  const { profile, release, registryUrl } = options;
  const project = mkdtempSync(join(tmpdir(), `print-an-agent-${profile.name}-`));
  try {
    const distance = relative(ROOT, project);
    if (distance === '' || (!distance.startsWith('..') && !isAbsolute(distance)))
      throw new Error('Independent consumption must run outside the source workspace.');
    for (const file of ['tsconfig.json', ...profile.sourceFiles]) {
      copyFileSync(join(ROOT, 'tooling/release/consumer', file), join(project, file));
    }
    copyFileSync(
      join(ROOT, 'modules/model-invocation/packages/pi/test/support/completion-server.ts'),
      join(project, 'completion-server.ts')
    );
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify(
        {
          name: `independent-print-an-agent-${profile.name}`,
          private: true,
          type: 'module',
          dependencies: Object.fromEntries(
            profile.dependencies.map((name) => [name, release.version])
          ),
          devDependencies: { typescript: '5.9.3', '@types/node': '24.12.4' },
        },
        null,
        2
      )
    );
    writeFileSync(
      join(project, '.npmrc'),
      `registry=${REGISTRY}\n@print-an-agent:registry=${registryUrl}/\n`
    );
    const env = packageManagerEnvironment(project);
    await run(project, env, 'npm', [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    await run(project, env, 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
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
    await run(project, env, join(project, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json']);
    console.log(
      await run(project, env, process.execPath, [
        '--test',
        '--test-timeout=30000',
        ...profile.testFiles,
      ])
    );

    const productionPaths = (
      await run(project, env, 'npm', ['ls', '--omit=dev', '--all', '--parseable'])
    )
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
    rmSync(join(project, 'node_modules'), { recursive: true });
    const store = ['--store-dir', join(project, 'pnpm-store')];
    await run(project, env, 'pnpm', ['install', '--ignore-scripts', '--lockfile-only', ...store]);
    await run(project, env, 'pnpm', ['install', '--ignore-scripts', '--frozen-lockfile', ...store]);
    const pnpmLock = readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8');
    for (const pkg of release.packages) {
      if (!pnpmLock.includes(pkg.integrity))
        throw new Error(`pnpm resolved a different artifact for ${pkg.name}.`);
    }
    await run(project, env, join(project, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json']);
    console.log(
      await run(project, env, process.execPath, [
        '--test',
        '--test-timeout=30000',
        ...profile.testFiles,
      ])
    );

    return {
      name: profile.name,
      directDependencies: profile.dependencies,
      testFiles: profile.testFiles,
      consumers: ['npm ci', 'pnpm install --frozen-lockfile'],
      licenses,
    };
  } finally {
    rmSync(project, { recursive: true });
  }
}
