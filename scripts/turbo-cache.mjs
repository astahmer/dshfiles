import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * One Turbo cache for every JJ workspace of this repository. Turbo keys a task on the content of its inputs, not on
 * the directory it runs in, so a linked workspace can replay another workspace's builds and browser checks. A
 * per-workspace `.turbo/cache` starts empty, which makes every fresh thread workspace rebuild and re-boot everything.
 * The Nix dev shell exports the same location, so bare `pnpm exec turbo` shares it too.
 */
export const turboCacheDir = () => {
  const configured = process.env.TURBO_CACHE_DIR
  if (configured !== undefined && configured !== '') return configured
  return resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), '.cache'), 'dshfiles/turbo')
}
