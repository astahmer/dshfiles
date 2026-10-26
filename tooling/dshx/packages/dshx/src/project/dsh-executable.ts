import { resolveExecutableOverride } from './executable-override.js'

/**
 * Scratch verification can bypass a personal `dsh` launcher that rewrites HOME.
 * Explicit API options keep their existing command-name semantics; the environment
 * override must be an absolute executable file and never falls back when invalid.
 */
export const resolveDshExecutable = async (explicit?: string, environment: NodeJS.ProcessEnv = process.env): Promise<string> =>
  explicit ?? (await resolveExecutableOverride('DSHX_DSH_EXECUTABLE', environment)) ?? 'dsh'
