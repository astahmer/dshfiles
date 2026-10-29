import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SecretGlobalConfig } from './secret-reference-status-schema.js'

const globalSecretConfigPath = (): string => join(homedir(), '.config', 'secret', 'config.json')

/**
 * Where a global alias really lands. When the config path is a symlink (a Nix or dotfiles manager links it into a
 * versioned clone), a write goes to that target, and an atomic rewrite can replace the link with a plain file that
 * the manager later moves aside — so the UI names the target instead of writing silently.
 */
export const inspectGlobalSecretConfig = async (path: string = globalSecretConfigPath()): Promise<SecretGlobalConfig> => {
  const stats = await lstat(path).catch(() => null)
  if (stats === null) return { path, linkedTo: null }
  if (!stats.isSymbolicLink()) return { path, linkedTo: null }
  return { path, linkedTo: await realpath(path).catch(() => null) }
}
