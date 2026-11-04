import { Git, type GitCommandFailed, type GitRunFailed } from '@dshfiles/git-cli'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { JjReadFailed } from './jj.js'
import type { ReviewBackend } from './review-backend.js'

const NOT_A_REPOSITORY = /not a git repository/i

const readFailed = (error: GitRunFailed | GitCommandFailed): JjReadFailed => {
  if (error._tag === 'GitRunFailed') return new JjReadFailed({ reason: error.reason === 'spawn-failed' ? 'jj-missing' : 'unreadable', cause: error })
  // stderr only classifies the failure and never leaves this module: a remote URL in it can carry credentials.
  return new JjReadFailed({ reason: NOT_A_REPOSITORY.test(error.stderr) ? 'not-a-repository' : 'jj-failed' })
}

/** A revision is never passed where git would read it as an option. */
const isSafeRevision = (revision: string): boolean => revision.length > 0 && !revision.startsWith('-') && !revision.includes('\0')

/**
 * The git adapter of the review port. A live review diffs from the merge base with the bookmark to a snapshot of the
 * worktree, built in a throwaway index so untracked files count and neither the real index nor HEAD moves; a saved
 * range diffs its two commits.
 */
export class ReviewGit extends Context.Service<ReviewGit, ReviewBackend>()('@dshfiles/pulls-review/ReviewGit') {
  static readonly layer = Layer.effect(
    ReviewGit,
    Effect.gen(function* () {
      const git = yield* Git
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const run = (args: readonly string[], cwd: string, env?: Readonly<Record<string, string>>) =>
        git.run({ args, cwd, env }).pipe(Effect.mapError(readFailed))
      const exec = (args: readonly string[], cwd: string, env?: Readonly<Record<string, string>>) =>
        git.exec({ args, cwd, env }).pipe(Effect.mapError(readFailed))

      const commit = Effect.fn('review git commit')(function* (input: { readonly path: string; readonly revision: string }) {
        if (!isSafeRevision(input.revision)) return ''
        const output = yield* run(['rev-parse', '--verify', '--quiet', '--short=12', `${input.revision}^{commit}`], input.path)
        if (output.exitCode === 0) return output.stdout.trim()
        if (NOT_A_REPOSITORY.test(output.stderr)) return yield* new JjReadFailed({ reason: 'not-a-repository' })
        return ''
      })

      const worktreeTree = (cwd: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* fileSystem
              .makeTempDirectoryScoped({ prefix: 'pulls-review-git-' })
              .pipe(Effect.mapError(cause => new JjReadFailed({ reason: 'unreadable', cause })))
            const index = { GIT_INDEX_FILE: path.join(directory, 'index') }
            yield* exec(['add', '--all', '.'], cwd, index)
            return (yield* exec(['write-tree'], cwd, index)).trim()
          }),
        )

      const diff = Effect.fn('review git diff')(function* (input: {
        readonly path: string
        readonly base: string
        readonly head: string
        readonly limit: number
      }) {
        if (!isSafeRevision(input.base) || !isSafeRevision(input.head)) return yield* new JjReadFailed({ reason: 'jj-failed' })
        const live = input.head === 'HEAD'
        const mergeBase = live ? (yield* exec(['merge-base', input.base, 'HEAD'], input.path)).trim() : input.base
        const to = live ? yield* worktreeTree(input.path) : input.head
        const output = yield* git
          .run({ args: ['diff', '--no-color', '--no-ext-diff', mergeBase, to, '--'], cwd: input.path, maxStdoutBytes: input.limit, onStdoutLimit: 'truncate' })
          .pipe(Effect.mapError(readFailed))
        if (output.exitCode !== 0) return yield* new JjReadFailed({ reason: NOT_A_REPOSITORY.test(output.stderr) ? 'not-a-repository' : 'jj-failed' })
        return { stdout: output.stdout, truncated: output.stdoutTruncated }
      })

      return ReviewGit.of({
        vcs: 'git',
        baseCandidates: ['main', 'master', 'trunk', 'origin/main', 'origin/master', 'origin/trunk'],
        liveHead: 'HEAD',
        savedRevision: id => id,
        resolves: input => Effect.map(commit(input), short => short.length > 0),
        commit,
        diff,
        messages: {
          missing: 'git is not available to the Host; install git.',
          notARepository: 'That thread workspace is not a git repository.',
          failed: 'git could not read this workspace.',
        },
      })
    }),
  )
}
