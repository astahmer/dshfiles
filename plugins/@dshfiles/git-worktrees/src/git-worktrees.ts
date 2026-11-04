import { homedir } from 'node:os'
import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Git } from '@dshfiles/git-cli'
import { Context, Effect, FileSystem, Layer, Option, Path, Random, Schema } from 'effect'
import { gitWorktreesSettings } from './settings.js'

export interface GitLocation {
  /** The main worktree: the repository a thread worktree belongs to. */
  readonly repoRoot: string
  readonly workspaceRoot: string
  /** Set when the worktree is one of the thread worktrees this plugin creates. */
  readonly threadName: string | undefined
}

export interface ThreadWorktree {
  readonly name: string
  readonly path: string
  readonly branch: string | null
}

export class GitFailed extends Schema.TaggedError<GitFailed>()(
  'GitFailed',
  { subcommand: Schema.String, exitCode: Schema.optional(Schema.Number), detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'git-failed' },
) {
  override get message(): string {
    return `git ${this.subcommand}: ${this.detail}`
  }
}

export class NotARepository extends Schema.TaggedError<NotARepository>()(
  'NotARepository',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-a-repository' },
) {
  override get message(): string {
    return `${this.path} is not inside a git repository.`
  }
}

export class NotAThreadWorktree extends Schema.TaggedError<NotAThreadWorktree>()(
  'NotAThreadWorktree',
  { path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'not-a-thread' },
) {
  override get message(): string {
    return `${this.path} is not a thread worktree this plugin created.`
  }
}

export class InvalidSnapshot extends Schema.TaggedError<InvalidSnapshot>()(
  'InvalidSnapshot',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-snapshot' },
) {
  override get message(): string {
    return 'That snapshot is not a git commit id.'
  }
}

const THREAD_NAME = /^thread-[0-9a-f]{6}$/u
const OBJECT_ID = /^[0-9a-f]{40,64}$/u
const MAX_STDERR_CHARACTERS = 400
const SNAPSHOT_AUTHOR = { GIT_AUTHOR_NAME: 'dsh', GIT_AUTHOR_EMAIL: 'dsh@localhost', GIT_COMMITTER_NAME: 'dsh', GIT_COMMITTER_EMAIL: 'dsh@localhost' }

const GitWorktreesSettings = Settings.Tag<SettingsValue<typeof gitWorktreesSettings.schema>>(gitWorktreesSettings.namespace)

/**
 * Plain git repositories: thread worktrees beside the repository and file snapshots as unreferenced-but-kept commits.
 * A snapshot is a commit of every tracked and untracked, non-ignored file under `refs/dsh/snapshots/`, built in a
 * throwaway index so neither the real index nor HEAD moves.
 */
export class GitWorktrees extends Context.Service<
  GitWorktrees,
  {
    /** Undefined outside a git repository. */
    readonly locate: (path: string) => Effect.Effect<GitLocation | undefined>
    readonly isolateByDefault: Effect.Effect<boolean>
    readonly worktrees: (repoRoot: string) => Effect.Effect<readonly ThreadWorktree[], GitFailed>
    readonly provision: (repoRoot: string, base: string | undefined) => Effect.Effect<ThreadWorktree, GitFailed>
    readonly remove: (path: string, force: boolean) => Effect.Effect<void, GitFailed | NotARepository | NotAThreadWorktree>
    readonly snapshot: (path: string) => Effect.Effect<string, GitFailed | NotARepository>
    readonly restore: (path: string, target: string) => Effect.Effect<string, GitFailed | NotARepository | InvalidSnapshot>
  }
>()('@dshfiles/git-worktrees/GitWorktrees') {
  static readonly layer = Layer.effect(
    GitWorktrees,
    Effect.gen(function* () {
      const cli = yield* Git
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const settings = yield* GitWorktreesSettings

      const threadsDirectoryOf = Effect.fnUntraced(function* (repoRoot: string) {
        const configured = (yield* settings.get).threadsDirectory.trim()
        if (configured === '') return `${repoRoot}-threads`
        return path.join(configured.startsWith('~/') ? path.join(homedir(), configured.slice(2)) : configured, path.basename(repoRoot))
      })

      /** One git run through `@dshfiles/git-cli`: its span, bounds and redacted stderr; failures keep this plugin's `GitFailed`. */
      const git = (args: readonly string[], cwd: string, env?: Readonly<Record<string, string>>) => {
        const subcommand = args[0] ?? ''
        return cli
          .exec({ args, cwd, env })
          .pipe(
            Effect.mapError(cause =>
              cause._tag === 'GitCommandFailed'
                ? new GitFailed({ subcommand, exitCode: cause.exitCode, detail: cause.detail.slice(0, MAX_STDERR_CHARACTERS), cause })
                : new GitFailed({ subcommand, detail: cause.message, cause }),
            ),
          )
      }

      const locate = Effect.fn('git locate')(function* (target: string) {
        const listed = yield* git(['rev-parse', '--show-toplevel', '--git-common-dir'], target).pipe(Effect.option)
        if (Option.isNone(listed)) return undefined
        const [toplevel, commonDir] = listed.value.trim().split('\n')
        if (toplevel === undefined || commonDir === undefined) return undefined
        const workspaceRoot = path.resolve(toplevel)
        const repoRoot = path.dirname(path.resolve(workspaceRoot, commonDir))
        const threadsDirectory = yield* threadsDirectoryOf(repoRoot)
        const isThread = workspaceRoot !== repoRoot && path.dirname(workspaceRoot) === threadsDirectory && THREAD_NAME.test(path.basename(workspaceRoot))
        const location: GitLocation = { repoRoot, workspaceRoot, threadName: isThread ? path.basename(workspaceRoot) : undefined }
        return location
      })

      const requireLocation = Effect.fnUntraced(function* (target: string) {
        const location = yield* locate(target)
        if (location === undefined) return yield* new NotARepository({ path: target })
        return location
      })

      const worktrees = Effect.fn('git thread worktrees')(function* (repoRoot: string) {
        const threadsDirectory = yield* threadsDirectoryOf(repoRoot)
        const listed = yield* git(['worktree', 'list', '--porcelain'], repoRoot)
        return listed.split('\n\n').flatMap((block): ThreadWorktree[] => {
          const lines = block.split('\n')
          const worktreePath = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
          const branch = lines.find(line => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null
          if (worktreePath === undefined || path.dirname(worktreePath) !== threadsDirectory || !THREAD_NAME.test(path.basename(worktreePath))) return []
          return [{ name: path.basename(worktreePath), path: worktreePath, branch }]
        })
      })

      const provision = Effect.fn('git thread provision')(function* (repoRoot: string, base: string | undefined) {
        const threadsDirectory = yield* threadsDirectoryOf(repoRoot)
        yield* fs
          .makeDirectory(threadsDirectory, { recursive: true })
          .pipe(Effect.mapError(cause => new GitFailed({ subcommand: 'worktree', detail: 'the threads directory could not be created.', cause })))
        const suffix = yield* Random.nextIntBetween(0, 0xff_ff_ff)
        const name = `thread-${suffix.toString(16).padStart(6, '0')}`
        const worktreePath = path.join(threadsDirectory, name)
        const branch = `dsh/${name}`
        yield* git(['worktree', 'add', '-b', branch, worktreePath, base ?? 'HEAD'], repoRoot)
        const thread: ThreadWorktree = { name, path: worktreePath, branch }
        return thread
      })

      const remove = Effect.fn('git thread remove')(function* (target: string, force: boolean) {
        const location = yield* requireLocation(target)
        if (location.threadName === undefined) return yield* new NotAThreadWorktree({ path: target })
        yield* git(['worktree', 'remove', ...(force ? ['--force'] : []), location.workspaceRoot], location.repoRoot)
      })

      const scratchIndex = (prefix: string) =>
        fs.makeTempDirectoryScoped({ prefix }).pipe(
          Effect.map(directory => ({ GIT_INDEX_FILE: path.join(directory, 'index') })),
          Effect.mapError(cause => new GitFailed({ subcommand: 'snapshot', detail: 'a scratch index could not be created.', cause })),
        )

      const snapshotOf = Effect.fnUntraced(function* (workspaceRoot: string) {
        const index = yield* scratchIndex('dsh-git-snapshot-')
        yield* git(['add', '--all', '.'], workspaceRoot, index)
        const tree = (yield* git(['write-tree'], workspaceRoot, index)).trim()
        const commit = (yield* git(['commit-tree', tree, '-m', 'dsh file snapshot'], workspaceRoot, SNAPSHOT_AUTHOR)).trim()
        if (!OBJECT_ID.test(commit)) return yield* new GitFailed({ subcommand: 'commit-tree', detail: 'returned no commit id.' })
        yield* git(['update-ref', `refs/dsh/snapshots/${commit}`, commit], workspaceRoot)
        return commit
      }, Effect.scoped)

      const snapshot = Effect.fn('git snapshot')(function* (target: string) {
        const location = yield* requireLocation(target)
        return yield* snapshotOf(location.workspaceRoot)
      })

      const restore = Effect.fn('git restore')(function* (target: string, snapshotId: string) {
        if (!OBJECT_ID.test(snapshotId)) return yield* new InvalidSnapshot({})
        const { workspaceRoot } = yield* requireLocation(target)
        const previous = yield* snapshotOf(workspaceRoot)
        const added = (yield* git(['diff', '--name-only', '-z', '--diff-filter=A', snapshotId, previous], workspaceRoot))
          .split('\0')
          .filter(file => file.length > 0)
        yield* Effect.forEach(
          added,
          file =>
            fs
              .remove(path.join(workspaceRoot, file), { force: true })
              .pipe(Effect.mapError(cause => new GitFailed({ subcommand: 'restore', detail: 'a file added since the snapshot could not be removed.', cause }))),
          { concurrency: 16, discard: true },
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const index = yield* scratchIndex('dsh-git-restore-')
            yield* git(['read-tree', snapshotId], workspaceRoot, index)
            yield* git(['checkout-index', '--all', '--force'], workspaceRoot, index)
          }),
        )
        return previous
      })

      return GitWorktrees.of({
        locate,
        isolateByDefault: Effect.map(settings.get, value => value.isolate),
        worktrees,
        provision,
        remove,
        snapshot,
        restore,
      })
    }),
  ).pipe(Layer.provide(Git.layer))
}
