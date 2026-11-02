import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveExecutableOverride } from './executable-override.js'

/** The CLI this checkout installed, when the caller has none on PATH (a CI runner has neither). */
const checkoutDsh = (projectRoot: string): string | undefined => {
  const candidate = join(projectRoot, 'node_modules', '.bin', 'dsh')
  return existsSync(candidate) ? candidate : undefined
}

/**
 * Scratch verification can bypass a personal `dsh` launcher that rewrites HOME.
 * Explicit API options keep their existing command-name semantics; the environment
 * override must be an absolute executable file and never falls back when invalid.
 * Otherwise the checkout's own bin wins over PATH, so a gate does not depend on the
 * shell that started it.
 */
export const resolveDshExecutable = async (explicit?: string, environment: NodeJS.ProcessEnv = process.env, projectRoot?: string): Promise<string> =>
  explicit ??
  (await resolveExecutableOverride('DSHX_DSH_EXECUTABLE', environment)) ??
  (projectRoot === undefined ? undefined : checkoutDsh(projectRoot)) ??
  'dsh'
