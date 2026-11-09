import { randomUUID } from 'node:crypto'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { projectChecksApi } from '@dshfiles/project-checks/api'
import type { ProjectChecksVerifiedTurn } from '@dshfiles/project-checks/completion-event'
import { Cause, Context, Effect, Layer, Option, Path, Ref } from 'effect'
import { ActivityLog, WorkspaceRegistry } from './host-edges-promise.js'
import { JjSettings } from './jj-settings.js'
import { ProjectBookmarks } from './project-bookmarks.js'
import { mayAutoIntegrateWorkspace } from './settings.js'
import { ThreadWorkspaces, type LandCandidateVerification, type ThreadRevision } from './thread-workspaces.js'
import type { ThreadLocation } from './thread-workspace-model.js'
import { WorkspaceSync } from './workspace-sync.js'

type ActivityLevel = 'routine' | 'notable' | 'attention'
type AutoIntegrationActivityState =
  | 'queued'
  | 'cancelled'
  | 'skipped'
  | 'failed'
  | 'landed'
  | 'nothing-to-land'
  | 'already-integrated'
  | 'patch-equivalent-work'
  | 'patch-equivalence-unavailable'
  | 'conflicted'
  | 'needs-description'
  | 'detached-work'
  | 'verification-failed'

const safePromptField = (value: string, maximumLength: number): string =>
  [...value]
    .map(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character
    })
    .join('')
    .replaceAll('`', "'")
    .slice(0, maximumLength)

const revisionLines = (revisions: readonly ThreadRevision[]): readonly string[] =>
  revisions.map(revision => `- ${safePromptField(revision.changeId, 64)} (${revision.commitId.slice(0, 12)})`)

/** Integrates a thread's work automatically once Project Checks verified its turn, within the configured scope. */
export class AutoIntegration extends Context.Service<AutoIntegration, { readonly handle: (turn: ProjectChecksVerifiedTurn) => Effect.Effect<void> }>()(
  '@dshfiles/jj-integration/AutoIntegration',
) {
  static readonly layer = Layer.effect(
    AutoIntegration,
    Effect.gen(function* () {
      const threads = yield* ThreadWorkspaces
      const registry = yield* WorkspaceRegistry
      const settings = yield* JjSettings
      const projectBookmarks = yield* ProjectBookmarks
      const sync = yield* WorkspaceSync
      const log = yield* ActivityLog
      const projectChecks = (yield* HostApis).client(projectChecksApi)
      const path = yield* Path.Path

      const handle = Effect.fn('jj-integration auto integration')(
        function* (turn: ProjectChecksVerifiedTurn) {
          if (turn.signal.aborted) return
          const sessionId = String(turn.sessionId)
          const owns = (sessionIds: readonly unknown[]) => sessionIds.map(String)
          const sessionWorkspaces = (yield* registry.list).filter(workspace => owns(workspace.sessionIds).includes(sessionId))
          const workspace = sessionWorkspaces[0]
          if (sessionWorkspaces.length !== 1 || workspace === undefined) return

          const mayIntegrate = Effect.fnUntraced(function* (input: { readonly location: ThreadLocation; readonly sessionIds: readonly unknown[] }) {
            const current = yield* settings.get
            return mayAutoIntegrateWorkspace({
              scope: current.autoIntegrationScope,
              isThreadWorkspace: input.location.threadName !== undefined,
              sessionId,
              sessionIds: owns(input.sessionIds),
              repositoryRoot: input.location.repoRoot,
              excludedRepositoryRoots: current.autoIntegrationExcludedRepositories,
            })
          })
          const initialLocation = yield* threads.locate(workspace.path).pipe(Effect.option)
          if (Option.isNone(initialLocation) || !(yield* mayIntegrate({ location: initialLocation.value, sessionIds: workspace.sessionIds }))) return

          const correlationId = randomUUID()
          const report = (state: AutoIntegrationActivityState, summary: string, level: ActivityLevel = 'notable', detail = `Turn ${String(turn.turn)}`) =>
            log.emit({ type: `workspace.auto_integration_${state}`, summary, detail, path: workspace.path, sessionId, correlationId, level })

          yield* report('queued', `Queued automatic integration for ${path.basename(workspace.path)}`)
          const bookmark = yield* projectBookmarks.bookmarkFor(initialLocation.value.repoRoot)
          const authorizedRepoRoot = yield* Ref.make<string | undefined>(undefined)
          const outcome = yield* threads
            .landVerified({
              path: workspace.path,
              bookmark,
              sessionId,
              expectedSourceRevision: turn.sourceRevision,
              cancelled: Effect.sync(() => turn.signal.aborted),
              authorize: location =>
                Effect.gen(function* () {
                  const current = yield* registry.resolveByPath(location.workspaceRoot)
                  if (current === undefined || current.path !== workspace.path || !(yield* mayIntegrate({ location, sessionIds: current.sessionIds })))
                    return false
                  const authorization = yield* projectChecks
                    .assertVerifiedCompletion({ sessionId: turn.sessionId, turn: turn.turn, sourceRevision: turn.sourceRevision })
                    .pipe(Effect.option)
                  if (Option.isNone(authorization) || authorization.value.status !== 'authorized') return false
                  yield* Ref.set(authorizedRepoRoot, location.repoRoot)
                  return true
                }).pipe(Effect.orDie),
              verifyCandidate: candidate =>
                projectChecks
                  .verifyCandidate({
                    sessionId: turn.sessionId,
                    turn: turn.turn,
                    sourceRevision: turn.sourceRevision,
                    expectedRevision: candidate.workingCopyCommitId,
                  })
                  .pipe(
                    Effect.map((result): LandCandidateVerification => {
                      if (result.status === 'passed') return { status: 'passed' }
                      if (result.status === 'cancelled' || turn.signal.aborted) return { status: 'cancelled' }
                      if (result.status === 'unavailable' && result.prompt === null) return { status: 'cancelled' }
                      const message = result.prompt ?? 'Project Checks did not verify the rebased candidate. The bookmark was not advanced.'
                      return result.status === 'stale' ? { status: 'stale', message } : { status: 'failed', message }
                    }),
                    Effect.catch(error =>
                      Effect.succeed<LandCandidateVerification>({
                        status: 'failed',
                        message:
                          error.kind === 'unavailable'
                            ? 'Project Checks became unavailable during automatic integration. The bookmark was not advanced; retry when it is available.'
                            : 'Project Checks could not verify the rebased candidate. The bookmark was not advanced; retry or integrate manually.',
                      }),
                    ),
                  ),
            })
            .pipe(Effect.exit)

          if (outcome._tag === 'Failure') {
            if (turn.signal.aborted) return yield* report('cancelled', 'Automatic integration was cancelled.', 'routine')
            const failure = Cause.findErrorOption(outcome.cause)
            if (Option.isSome(failure) && failure.value._tag === 'NotAThread')
              return yield* report('skipped', 'Automatic integration skipped a shared or unmanaged workspace.', 'routine')
            turn.requestAgentFix(
              'Automatic integration could not safely rebase this thread. The main bookmark was not advanced; resolve the issue and stop again, or integrate manually.',
            )
            return yield* report('failed', 'Automatic integration stopped before advancing the bookmark.', 'attention')
          }

          const landed = outcome.value
          const bookmarkLabel = safePromptField(bookmark, 128)
          if (landed.status === 'landed') {
            const repoRoot = yield* Ref.get(authorizedRepoRoot)
            if (repoRoot !== undefined) yield* sync.enqueue({ repoRoot, bookmark, revision: landed.head.commitId, sessionId, correlationId })
            return yield* report('landed', `Automatically rebased ${String(landed.revisions.length)} revision(s) onto ${bookmarkLabel}.`)
          }
          if (landed.status === 'nothing-to-land') return yield* report('nothing-to-land', 'Automatic integration found no remaining work.', 'routine')
          if (landed.status === 'already-integrated')
            return yield* report(
              'already-integrated',
              `All remaining revisions already match patches in ${bookmarkLabel}. No rebase or bookmark change was made.`,
              'routine',
            )
          if (landed.status === 'patch-equivalent-work') {
            turn.requestAgentFix(
              [
                'Automatic integration found revisions with exact patch matches in target history:',
                ...revisionLines(landed.revisions),
                'Do not rebase this mixed branch automatically. Separate represented revisions from unique work, then stop for Project Checks again. The bookmark was not changed.',
              ].join('\n'),
            )
            return yield* report('patch-equivalent-work', 'Automatic integration paused to avoid replaying represented patches.', 'attention')
          }
          if (landed.status === 'patch-equivalence-unavailable') {
            turn.requestAgentFix(
              [
                'Automatic integration could not safely compare these revision patches:',
                ...revisionLines(landed.revisions),
                'Inspect the patches and target history manually. No rebase or bookmark change was made; stop for Project Checks again only after resolving the uncertainty.',
              ].join('\n'),
            )
            return yield* report('patch-equivalence-unavailable', 'Automatic integration paused because patch equivalence could not be proven.', 'attention')
          }
          if (landed.status === 'detached-work') {
            turn.requestAgentFix(
              [
                'Automatic integration stopped because this thread has detached revisions that are not covered by the current completion checks:',
                ...revisionLines(landed.revisions),
                'Inspect and reattach only the intended work into this thread’s active working copy, then stop for Project Checks again. Do not advance the bookmark or discard these revisions directly.',
              ].join('\n'),
            )
            return yield* report(
              'detached-work',
              'Automatic integration paused for detached revisions.',
              'attention',
              `${String(landed.revisions.length)} detached revision(s) · turn ${String(turn.turn)}`,
            )
          }
          if (landed.status === 'conflicted') {
            const files = landed.files.map(file => safePromptField(file, 240))
            turn.requestAgentFix(
              [
                `Automatic integration onto \`${bookmarkLabel}\` stopped with conflicts in:`,
                ...files.map(file => `- ${file}`),
                'Resolve them in this dedicated workspace and keep each revision described. The bookmark was not advanced; after Project Checks pass again, the queue will retry against the latest bookmark.',
              ].join('\n'),
            )
            return yield* report(
              'conflicted',
              'Automatic integration stopped on rebase conflicts.',
              'attention',
              `${String(files.length)} conflicted file(s) · turn ${String(turn.turn)}`,
            )
          }
          if (landed.status === 'needs-description') {
            turn.requestAgentFix(
              [
                `Automatic integration onto \`${bookmarkLabel}\` stopped because these revisions have no real description:`,
                ...landed.revisions.map(revision => `- ${safePromptField(revision.changeId, 64)}`),
                'Describe each revision with `jj describe -r <change-id> -m "<conventional commit message>"`. The bookmark was not advanced; after Project Checks pass again, the queue will retry.',
              ].join('\n'),
            )
            return yield* report(
              'needs-description',
              'Automatic integration stopped on undescribed revisions.',
              'attention',
              `${String(landed.revisions.length)} revision(s) · turn ${String(turn.turn)}`,
            )
          }
          if (landed.status === 'verification-failed' || landed.status === 'verification-stale') {
            turn.requestAgentFix(landed.message)
            return yield* report('verification-failed', 'Project Checks did not verify the rebased candidate; the bookmark was not advanced.', 'attention')
          }
          if (landed.status === 'verification-cancelled')
            return yield* report('cancelled', 'Automatic integration was cancelled before the bookmark moved.', 'routine')
          yield* report('skipped', 'Automatic integration skipped because workspace ownership or completion verification could not be revalidated.', 'routine')
        },
        effect => Effect.catchCause(effect, cause => Effect.logWarning('jj-integration: automatic integration failed', cause)),
      )

      return AutoIntegration.of({ handle })
    }),
  )
}
