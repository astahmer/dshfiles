import { Context, Effect, Layer } from 'effect'
import { GitCli } from './git-cli.js'
import { GitThreadWorkspaces } from './git-thread-workspaces.js'
import { JjThreadWorkspaces } from './jj-thread-workspaces.js'
import { ThreadMetadata } from './thread-metadata.js'
import type {
  DiscardOutcome,
  LandAtOptions,
  LandCandidate,
  LandCandidateVerification,
  LandOutcome,
  LandPhase,
  ManagedThread,
  SecondaryDiscardResult,
  SecondaryWorkspaceStatus,
  ThreadDiscardResult,
  ThreadRevision,
  ThreadStatus,
  ThreadWorkspacesBackend,
  UntrackedEntry,
  VerifiedLandOptions,
  VerifiedLandOutcome,
} from './thread-workspace-types.js'
import type { IntegrationRecord } from './thread-metadata.js'
import type { VcsKind } from './thread-workspace-model.js'
import { VcsDetector } from './vcs-detector.js'

export type {
  DiscardOutcome,
  IntegrationRecord,
  LandAtOptions,
  LandCandidate,
  LandCandidateVerification,
  LandOutcome,
  LandPhase,
  ManagedThread,
  SecondaryDiscardResult,
  SecondaryWorkspaceStatus,
  ThreadDiscardResult,
  ThreadRevision,
  ThreadStatus,
  ThreadWorkspacesBackend,
  UntrackedEntry,
  VerifiedLandOptions,
  VerifiedLandOutcome,
}

/** The port every caller uses, plus which backend serves a path. */
export type ThreadWorkspacesService = Omit<ThreadWorkspacesBackend, 'vcs'> & {
  /** The VCS that owns a path: jj when `.jj` exists (also when colocated with git), git for a git-only checkout. */
  readonly vcsAt: (target: string) => Effect.Effect<VcsKind>
}

const make = Effect.gen(function* () {
  const jj = yield* JjThreadWorkspaces
  const git = yield* GitThreadWorkspaces
  const detector = yield* VcsDetector

  const backendFor = (target: string) => Effect.map(detector.kindOf(target), kind => (kind === 'git' ? git : jj))
  const on =
    <Args extends readonly unknown[], A, E>(key: (...args: Args) => string, call: (backend: ThreadWorkspacesBackend, ...args: Args) => Effect.Effect<A, E>) =>
    (...args: Args): Effect.Effect<A, E> =>
      Effect.flatMap(backendFor(key(...args)), backend => call(backend, ...args))

  return {
    vcsAt: detector.kindOf,
    threadsDirectory: on(
      (repoRoot: string) => repoRoot,
      (backend, repoRoot) => backend.threadsDirectory(repoRoot),
    ),
    locate: on(
      (target: string) => target,
      (backend, target) => backend.locate(target),
    ),
    list: on(
      (repoRoot: string) => repoRoot,
      (backend, repoRoot) => backend.list(repoRoot),
    ),
    status: on(
      (repoRoot: string, _name: string) => repoRoot,
      (backend, repoRoot, name) => backend.status(repoRoot, name),
    ),
    reviewHistory: on(
      (input: { readonly repoRoot: string; readonly name: string }) => input.repoRoot,
      (backend, input) => backend.reviewHistory(input),
    ),
    provision: on(
      (repoRoot: string, _base?: string, _requestedName?: string) => repoRoot,
      (backend, repoRoot, base, requestedName) => backend.provision(repoRoot, base, requestedName),
    ),
    prewarm: on(
      (repoRoot: string, _base?: string) => repoRoot,
      (backend, repoRoot, base) => backend.prewarm(repoRoot, base),
    ),
    branchPoint: on(
      (workspaceRoot: string) => workspaceRoot,
      (backend, workspaceRoot) => backend.branchPoint(workspaceRoot),
    ),
    restore: on(
      (repoRoot: string, _workspacePath: string) => repoRoot,
      (backend, repoRoot, workspacePath) => backend.restore(repoRoot, workspacePath),
    ),
    land: (target, input) => Effect.flatMap(backendFor(target), backend => backend.land(target, input)),
    // A location already names its backend; one built before git support is jj's.
    landAt: (thread, input) => (thread.vcs === 'git' ? git : jj).landAt(thread, input),
    landVerified: on(
      (input: Parameters<ThreadWorkspacesBackend['landVerified']>[0]) => input.path,
      (backend, input) => backend.landVerified(input),
    ),
    discard: on(
      (input: Parameters<ThreadWorkspacesBackend['discard']>[0]) => input.repoRoot,
      (backend, input) => backend.discard(input),
    ),
    discardMany: on(
      (input: Parameters<ThreadWorkspacesBackend['discardMany']>[0]) => input.repoRoot,
      (backend, input) => backend.discardMany(input),
    ),
    secondaryWorkspaces: on(
      (repoRoot: string) => repoRoot,
      (backend, repoRoot) => backend.secondaryWorkspaces(repoRoot),
    ),
    discardSecondaryMany: on(
      (input: Parameters<ThreadWorkspacesBackend['discardSecondaryMany']>[0]) => input.repoRoot,
      (backend, input) => backend.discardSecondaryMany(input),
    ),
    workingCopyChangedAt: on(
      (repoRoot: string) => repoRoot,
      (backend, repoRoot) => backend.workingCopyChangedAt(repoRoot),
    ),
    danglingEmptyRevisions: on(
      (input: Parameters<ThreadWorkspacesBackend['danglingEmptyRevisions']>[0]) => input.repoRoot,
      (backend, input) => backend.danglingEmptyRevisions(input),
    ),
    untrackedEntries: on(
      (repoRoot: string) => repoRoot,
      (backend, repoRoot) => backend.untrackedEntries(repoRoot),
    ),
    removeUntrackedEntry: on(
      (input: Parameters<ThreadWorkspacesBackend['removeUntrackedEntry']>[0]) => input.repoRoot,
      (backend, input) => backend.removeUntrackedEntry(input),
    ),
    bookmarks: on(
      (target: string) => target,
      (backend, target) => backend.bookmarks(target),
    ),
    workingCopyCommitId: on(
      (target: string) => target,
      (backend, target) => backend.workingCopyCommitId(target),
    ),
    snapshotFiles: on(
      (target: string) => target,
      (backend, target) => backend.snapshotFiles(target),
    ),
    restoreFiles: on(
      (target: string, _snapshot: string) => target,
      (backend, target, snapshot) => backend.restoreFiles(target, snapshot),
    ),
    revisionGraph: on(
      (target: string) => target,
      (backend, target) => backend.revisionGraph(target),
    ),
  } satisfies ThreadWorkspacesService
})

/**
 * Thread workspaces of every repository, whichever VCS holds it: each call goes to the jj or git adapter that owns
 * its path. Both adapters are layers of their own, so a test or another Host can provide a different backend.
 */
export class ThreadWorkspaces extends Context.Service<ThreadWorkspaces, ThreadWorkspacesService>()('@dshfiles/jj-integration/ThreadWorkspaces') {
  /** The router alone, for callers that provide their own backends. */
  static readonly routerLayer = Layer.effect(
    ThreadWorkspaces,
    Effect.map(make, service => ThreadWorkspaces.of(service)),
  )

  /** The router over the jj and git adapters; needs jj view reads, a process spawner, the filesystem and settings. */
  static readonly layer = ThreadWorkspaces.routerLayer.pipe(
    Layer.provide(Layer.mergeAll(JjThreadWorkspaces.layer, GitThreadWorkspaces.layer, VcsDetector.layer)),
    Layer.provide(Layer.mergeAll(ThreadMetadata.layer, GitCli.layer)),
  )
}
