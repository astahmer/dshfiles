import { PluginApiError } from '@dshfiles/dshx/api'
import { Cause, Effect, Exit } from 'effect'
import type { ThreadWorkspaces, LandCandidate, LandCandidateVerification, LandPhase, VerifiedLandOptions } from './thread-workspaces.js'
import type { ThreadLocation } from './thread-workspace-model.js'

export type ThreadErrorCode = 'not-a-repository' | 'not-a-thread' | 'jj-failed' | 'git-failed' | 'unsafe-path' | 'workspace-files-failed'

/** A `ThreadWorkspaces` failure as the Promise half of the Host still reads it: a `PluginApiError` with its wire code. */
export class ThreadError extends PluginApiError {
  constructor(code: ThreadErrorCode, message: string) {
    super(message, { code })
  }
}

const codeByTag = {
  NotARepository: 'not-a-repository',
  NotAThread: 'not-a-thread',
  JjFailed: 'jj-failed',
  GitFailed: 'git-failed',
  UnsafePath: 'unsafe-path',
  WorkspaceFilesFailed: 'workspace-files-failed',
} satisfies Readonly<Record<string, ThreadErrorCode>>

const isTaggedWithCode = (tag: string): tag is keyof typeof codeByTag => tag in codeByTag

const thrown = (cause: Cause.Cause<unknown>): Error => {
  const error = Cause.squash(cause)
  if (!(error instanceof Error)) return new Error(String(error))
  if (!('_tag' in error) || typeof error._tag !== 'string' || !isTaggedWithCode(error._tag)) return error
  return new ThreadError(codeByTag[error._tag], error.message)
}

export type ThreadsRunner = <A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal) => Promise<Exit.Exit<A, E>>

type Service = ThreadWorkspaces['Service']

interface PromiseLandOptions {
  readonly bookmark?: string | undefined
  readonly signal?: AbortSignal | undefined
  readonly sessionId?: string | undefined
  readonly validate?: () => Promise<void>
  readonly onProgress?: (phase: LandPhase) => void
}

/**
 * The thread workspaces as Promises, for tests written against the Promise API. A rejected callback rethrows
 * its own error, and a domain failure rethrows as a `ThreadError` carrying the same wire code.
 */
export const promiseThreads = (input: { readonly service: Service; readonly run: ThreadsRunner }) => {
  const service = input.service
  const call = async <A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> => {
    const exit = await input.run(effect, signal)
    if (Exit.isSuccess(exit)) return exit.value
    throw thrown(exit.cause)
  }
  const landOptions = (options: PromiseLandOptions) => ({
    bookmark: options.bookmark,
    sessionId: options.sessionId,
    validate: options.validate === undefined ? undefined : Effect.promise(options.validate),
    onProgress: options.onProgress === undefined ? undefined : (phase: LandPhase) => Effect.sync(() => options.onProgress?.(phase)),
  })
  return {
    threadsDirectory: (repoRoot: string) => call(service.threadsDirectory(repoRoot)),
    locate: (path: string, signal?: AbortSignal) => call(service.locate(path), signal),
    list: (repoRoot: string) => call(service.list(repoRoot)),
    status: (repoRoot: string, name: string) => call(service.status(repoRoot, name)),
    reviewHistory: (target: { readonly repoRoot: string; readonly name: string }) => call(service.reviewHistory(target)),
    provision: (repoRoot: string, base?: string, requestedName?: string) => call(service.provision(repoRoot, base, requestedName)),
    prewarm: (repoRoot: string, base?: string): void => {
      void call(service.prewarm(repoRoot, base)).catch(() => undefined)
    },
    branchPoint: (workspaceRoot: string, signal?: AbortSignal) => call(service.branchPoint(workspaceRoot), signal),
    restore: (repoRoot: string, path: string) => call(service.restore(repoRoot, path)),
    land: (path: string, options: PromiseLandOptions = {}) => call(service.land(path, landOptions(options)), options.signal),
    landAt: (thread: ThreadLocation & { readonly threadName: string }, options: PromiseLandOptions = {}) =>
      call(service.landAt(thread, landOptions(options)), options.signal),
    landVerified: (
      options: Omit<VerifiedLandOptions, 'authorize' | 'verifyCandidate' | 'cancelled'> & {
        readonly signal?: AbortSignal | undefined
        readonly authorize: (location: ThreadLocation) => Promise<boolean>
        readonly verifyCandidate: (candidate: LandCandidate) => Promise<LandCandidateVerification>
      },
    ) =>
      call(
        service.landVerified({
          path: options.path,
          bookmark: options.bookmark,
          sessionId: options.sessionId,
          expectedSourceRevision: options.expectedSourceRevision,
          authorize: location => Effect.promise(() => options.authorize(location)),
          verifyCandidate: candidate => Effect.promise(() => options.verifyCandidate(candidate)),
          cancelled: Effect.sync(() => options.signal?.aborted === true),
        }),
      ),
    discard: (target: { readonly repoRoot: string; readonly name: string; readonly force: boolean }) => call(service.discard(target)),
    discardMany: (target: { readonly repoRoot: string; readonly names: readonly string[]; readonly force: boolean }) => call(service.discardMany(target)),
    secondaryWorkspaces: (repoRoot: string) => call(service.secondaryWorkspaces(repoRoot)),
    discardSecondaryMany: (target: Parameters<Service['discardSecondaryMany']>[0]) => call(service.discardSecondaryMany(target)),
    workingCopyChangedAt: (repoRoot: string) => call(service.workingCopyChangedAt(repoRoot)),
    danglingEmptyRevisions: (target: { readonly repoRoot: string; readonly abandon: boolean }) => call(service.danglingEmptyRevisions(target)),
    untrackedEntries: (repoRoot: string) => call(service.untrackedEntries(repoRoot)),
    removeUntrackedEntry: (target: { readonly repoRoot: string; readonly name: string }) => call(service.removeUntrackedEntry(target)),
    bookmarks: (path: string) => call(service.bookmarks(path)),
    workingCopyCommitId: (path: string, signal?: AbortSignal) => call(service.workingCopyCommitId(path), signal),
    snapshotFiles: (path: string, signal?: AbortSignal) => call(service.snapshotFiles(path), signal),
    restoreFiles: (path: string, snapshot: string, signal?: AbortSignal) => call(service.restoreFiles(path, snapshot), signal),
    revisionGraph: (path: string) => call(service.revisionGraph(path)),
  }
}

export type Threads = ReturnType<typeof promiseThreads>
