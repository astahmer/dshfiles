import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect, FileSystem } from 'effect'
import type { SecretGlobalConfig } from './secret-reference-status-schema.js'

const globalSecretConfigPath = (): string => join(homedir(), '.config', 'secret', 'config.json')

/**
 * Where a global alias really lands. When the config path is a symlink (a Nix or dotfiles manager links it into a
 * versioned clone), a write goes to that target, and an atomic rewrite can replace the link with a plain file that
 * the manager later moves aside — so the UI names the target instead of writing silently.
 */
export const inspectGlobalSecretConfig = Effect.fn('secret global config inspect')(function* (path: string = globalSecretConfigPath()) {
  const fileSystem = yield* FileSystem.FileSystem
  const linked = yield* fileSystem.readLink(path).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
  if (!linked) return { path, linkedTo: null } satisfies SecretGlobalConfig
  const linkedTo = yield* fileSystem.realPath(path).pipe(Effect.orElseSucceed(() => null))
  return { path, linkedTo } satisfies SecretGlobalConfig
})
