import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The DSH home this Host runs under: an explicit override, `$DSH_HOME`, then
 * `~/.dsh` — the same resolution the other owned plugins use, so a scratch or
 * second instance keeps its own state instead of writing into the user's home.
 */
export const dshHome = (override?: string): string => {
  const trimmed = override?.trim()
  if (trimmed !== undefined && trimmed !== '') return resolve(trimmed)
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}
