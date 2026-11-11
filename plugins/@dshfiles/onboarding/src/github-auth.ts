import { Duration, Effect, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export type GithubAuthStatus = 'signed-in' | 'signed-out' | 'missing' | 'failed'

const MISSING_EXECUTABLE = /ENOENT|not ?found|no such file/iu

/** Whether a spawn failure means the executable is absent; the platform error's shape is read without trusting it. */
const isMissingExecutable = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const reason = 'reason' in error && typeof error.reason === 'object' && error.reason !== null && '_tag' in error.reason ? error.reason._tag : undefined
  if (reason === 'NotFound') return true
  const message = 'message' in error ? String(error.message) : ''
  const cause = 'cause' in error ? String(error.cause) : ''
  return MISSING_EXECUTABLE.test(message) || MISSING_EXECUTABLE.test(cause)
}

const drain = <E>(stream: Stream.Stream<Uint8Array, E>) => Stream.runDrain(stream)

/**
 * `gh auth status --hostname github.com`, one `onboarding gh auth` span per run. Exit 0 is signed in, any other exit is
 * signed out; a spawn that finds no executable is `missing`, and a run over five seconds is `failed`. Output is never
 * read: it can name the account and token scopes.
 */
export const checkGithubAuth = (input: { readonly executable: string }): Effect.Effect<GithubAuthStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const command = ChildProcess.make(input.executable, ['auth', 'status', '--hostname', 'github.com'], {
      stdin: 'ignore',
      forceKillAfter: Duration.seconds(1),
    })
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const process = yield* spawner.spawn(command)
        const [, , exitCode] = yield* Effect.all([drain(process.stdout), drain(process.stderr), process.exitCode], { concurrency: 'unbounded' })
        return exitCode === 0 ? ('signed-in' as const) : ('signed-out' as const)
      }),
    ).pipe(
      Effect.timeout(Duration.seconds(5)),
      Effect.catch(error => Effect.succeed(isMissingExecutable(error) ? ('missing' as const) : ('failed' as const))),
      Effect.tap(status => Effect.annotateCurrentSpan({ 'onboarding.github.status': status })),
      Effect.withSpan('onboarding gh auth', { kind: 'client', attributes: { 'process.executable.name': 'gh' } }),
    )
  })
