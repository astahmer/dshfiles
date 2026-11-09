import { join } from 'node:path'
import { Context, Duration, Effect, FileSystem, Layer, Option, Schema } from 'effect'
import type { FolderInspection } from './project-lifecycle-api.js'
import { ExecutableLookup, nearestRepositoryMarker, ProjectCommands, ProjectHome, type RepositoryMarker } from './project-lifecycle.js'

const GIT_TIMEOUT = Duration.seconds(20)

export class FolderUnreadable extends Schema.TaggedError<FolderUnreadable>()(
  'FolderUnreadable',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'folder-unreadable' },
) {
  override get message(): string {
    return `${this.path} is not a folder this Host can read. Pick an existing folder, or check its permissions.`
  }
}

const readGit = (commands: ProjectCommands['Service'], root: string, args: readonly string[], cwd: string) => {
  const argv: [string, ...string[]] = ['git', '-C', root, ...args]
  return commands.run({ argv, cwd }).pipe(
    Effect.timeoutOption(GIT_TIMEOUT),
    Effect.map(result => {
      if (Option.isNone(result) || result.value.exitCode !== 0) return null
      const text = result.value.stdout.trim()
      return text.length === 0 ? null : text
    }),
    Effect.orElseSucceed(() => null),
  )
}

const inspectionOf = (input: {
  readonly path: string
  readonly jjInstalled: boolean
  readonly marker: Option.Option<RepositoryMarker>
  readonly remoteUrl: string | null
  readonly defaultBranch: string | null
}): FolderInspection => {
  const marker = input.marker
  if (Option.isNone(marker)) {
    return {
      path: input.path,
      kind: 'none',
      repositoryRoot: null,
      remoteUrl: null,
      defaultBranch: null,
      gitAbove: false,
      brokenJjMetadata: false,
      canEnableJujutsu: false,
      reason: 'Not a Git checkout, so Jujutsu cannot be enabled alongside Git. Turn the folder into a repository instead.',
    }
  }
  const found = marker.value
  const gitAbove = found.root !== input.path
  if (found.kind === 'jujutsu') {
    return {
      path: input.path,
      kind: 'jujutsu',
      repositoryRoot: found.root,
      remoteUrl: input.remoteUrl,
      defaultBranch: input.defaultBranch,
      gitAbove,
      brokenJjMetadata: found.broken,
      canEnableJujutsu: false,
      reason: found.broken ? 'Its .jj metadata looks broken, so Jujutsu commands will not work until it is repaired or removed.' : null,
    }
  }
  const blocked = found.broken
    ? 'Its .jj metadata looks broken, so Jujutsu will not start until it is repaired or removed.'
    : input.jjInstalled
      ? null
      : 'Install jj (https://jj-vcs.github.io) and reload DSH to enable it.'
  return {
    path: input.path,
    kind: 'git',
    repositoryRoot: found.root,
    remoteUrl: input.remoteUrl,
    defaultBranch: input.defaultBranch,
    gitAbove,
    brokenJjMetadata: found.broken,
    canEnableJujutsu: blocked === null,
    reason: blocked,
  }
}

/**
 * Reads what a folder is before it becomes a project: no repository, a Git checkout or a Jujutsu repository, plus the
 * origin URL and default branch the composer would otherwise hide behind an empty workspace state. It never writes.
 */
export class FolderInspector extends Context.Service<
  FolderInspector,
  { readonly inspect: (path: string) => Effect.Effect<FolderInspection, FolderUnreadable> }
>()('@dshfiles/workspace-folder-picker/FolderInspector') {
  static readonly layer = Layer.effect(
    FolderInspector,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const commands = yield* ProjectCommands
      const lookup = yield* ExecutableLookup
      const home = yield* ProjectHome

      const inspect = Effect.fn('project inspect')(function* (rawPath: string) {
        const path = rawPath.startsWith('~/') || rawPath.startsWith('~\\') ? join(home, rawPath.slice(2)) : rawPath
        const info = yield* fs.stat(path).pipe(Effect.mapError(cause => new FolderUnreadable({ path, cause })))
        if (info.type !== 'Directory') return yield* new FolderUnreadable({ path })
        const [git, jj] = yield* Effect.all([lookup.resolve('git'), lookup.resolve('jj')], { concurrency: 'unbounded' })
        const marker = yield* nearestRepositoryMarker(fs, path)
        yield* Effect.annotateCurrentSpan({
          'dshx.inspect.kind': Option.isSome(marker) ? marker.value.kind : 'none',
          'dshx.inspect.root': Option.isSome(marker) ? marker.value.root : path,
        })
        // A remote read only makes sense for a repository this Host can run git in.
        if (Option.isNone(marker) || Option.isNone(git)) {
          return inspectionOf({ path, jjInstalled: Option.isSome(jj), marker, remoteUrl: null, defaultBranch: null })
        }
        const [remoteUrl, head] = yield* Effect.all(
          [
            readGit(commands, marker.value.root, ['config', '--get', 'remote.origin.url'], path),
            readGit(commands, marker.value.root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], path),
          ],
          { concurrency: 'unbounded' },
        )
        const defaultBranch = head === null ? null : (head.split('/').at(-1) ?? null)
        return inspectionOf({ path, jjInstalled: Option.isSome(jj), marker, remoteUrl, defaultBranch })
      })

      return FolderInspector.of({ inspect })
    }),
  )
}
