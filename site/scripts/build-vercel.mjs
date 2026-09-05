import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, LOTTO_DEPLOY_TARGET: 'vercel' };

for (const [script, ...args] of [
  ['scripts/validate-lotto-data.mjs'],
  ['node_modules/vinext/dist/cli.js', 'build'],
  ['scripts/validate-lotto-data.mjs', '--built', '--static'],
]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: siteRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
