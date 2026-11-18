import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Avoid reading credentials or package-manager settings from the developer's account. */
export function packageManagerEnvironment(directory: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(?:npm_config_|NODE_AUTH_TOKEN$|NPM_TOKEN$|GH_TOKEN$|GITHUB_TOKEN$|NODE_PATH$)/i.test(
          name
        )
    )
  );
  env.NPM_CONFIG_USERCONFIG = join(directory, 'user.npmrc');
  env.NPM_CONFIG_GLOBALCONFIG = join(directory, 'global.npmrc');
  env.NPM_CONFIG_CACHE = join(directory, 'npm-cache');
  writeFileSync(env.NPM_CONFIG_USERCONFIG, '');
  writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '');
  return env;
}
