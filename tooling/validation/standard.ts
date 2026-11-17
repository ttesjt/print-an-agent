import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, extname, normalize, relative } from 'node:path';

const WORKFLOW_CONTRACT_PACKAGES = [
  '@print-an-agent/workflow-core',
  '@print-an-agent/workflow-bundle',
];
const WORKFLOW_QUALIFICATION = '@print-an-agent/workflow-qualification';

type WorkspacePackage = {
  name: string;
  path: string;
};

function readMergeBase(base: string): string {
  const options = { encoding: 'utf8', stdio: 'pipe' } as const;
  try {
    const commit = execFileSync(
      'git',
      ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`],
      options
    ).trim();
    return execFileSync('git', ['merge-base', 'HEAD', commit], options).trim();
  } catch {
    console.error(
      `Cannot compare HEAD with ${base}. Fetch the base branch or pass a local Git revision.`
    );
    process.exit(1);
  }
}

function selectChangedPackages(mergeBase: string, workspacePackages: WorkspacePackage[]): string[] {
  const packageByPath = new Map(
    workspacePackages.map((workspacePackage) => [
      relative(process.cwd(), workspacePackage.path),
      workspacePackage.name,
    ])
  );
  const tracked = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', mergeBase, '--'],
    {
      encoding: 'utf8',
    }
  );
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  const selected = new Set<string>();

  for (const file of [...tracked.split('\0'), ...untracked.split('\0')]) {
    if (!file || extname(file) === '.md') continue;
    let directory = dirname(normalize(file));
    while (directory !== '.') {
      const packageName = packageByPath.get(directory);
      if (packageName) {
        selected.add(packageName);
        break;
      }
      directory = dirname(directory);
    }
  }
  return [...selected].sort();
}

function runPnpm(pnpmPath: string, args: string[]): void {
  const result = spawnSync(process.execPath, [pnpmPath, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runPackageTask(pnpmPath: string, packages: Iterable<string>, task: string): void {
  const filters = [...packages].flatMap((name) => ['--filter', name]);
  runPnpm(pnpmPath, ['-r', ...filters, 'run', '--if-present', task]);
}

const pnpmPath = process.env.npm_execpath;
if (!pnpmPath || process.argv.length > 3) {
  console.error('Usage: pnpm validate:standard [base]');
  process.exit(1);
}

const mergeBase = readMergeBase(process.argv[2] ?? 'origin/main');
const workspacePackages = JSON.parse(
  execFileSync(process.execPath, [pnpmPath, '-r', 'list', '--depth', '-1', '--json'], {
    encoding: 'utf8',
  })
) as WorkspacePackage[];
const changedPackages = selectChangedPackages(mergeBase, workspacePackages);

runPnpm(pnpmPath, ['run', 'validate:quick']);

if (changedPackages.length === 0) {
  console.log('No changed workspace packages for typecheck, lint, or tests.');
} else {
  const typecheckPackages = new Set(changedPackages);
  if (WORKFLOW_CONTRACT_PACKAGES.some((name) => typecheckPackages.has(name))) {
    typecheckPackages.add(WORKFLOW_QUALIFICATION);
  }
  runPackageTask(pnpmPath, typecheckPackages, 'typecheck');

  for (const task of ['lint', 'test']) {
    runPackageTask(pnpmPath, changedPackages, task);
  }
}
