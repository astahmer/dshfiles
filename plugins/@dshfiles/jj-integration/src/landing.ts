import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer, Option, Path } from 'effect'
import type { LandResult } from './api.js'
import { IntegrationCancelled, IntegrationQueued, NotAThread, ThreadActive, ThreadActivityUnknown } from './errors.js'
import { ActivityLog, SessionPrompt, WorkspaceRegistry } from './host-edges-promise.js'
import { IntegrationRecovery } from './integration-recovery.js'
import { IntegrationRequests } from './integration-requests.js'
import { JjSettings } from './jj-settings.js'
import { RepositoryViews } from './repository-views.js'
import { SessionActivity } from './session-activity.js'
import { ThreadRebaseEligibilityModel, type ThreadActivityBlocker } from './thread-rebase-eligibility.js'
import { ThreadWorkspaces } from './thread-workspaces.js'
import { WorkspaceSync } from './workspace-sync.js'

const landingMessage = (outcome: LandResult): string | undefined => {
  const bookmark = outcome.bookmark
  if (outcome.status === 'conflicted') {
    return [
      `Rebasing this thread onto \`${bookmark}\` stopped with conflicts in:`,
      ...outcome.files.map(file => `- ${file}`),
      'Resolve them in this workspace (edit the files so no conflict markers remain; the conflicted revisions are already rebased), keep every revision described, then call the `jj_thread_rebase` tool again.',
    ].join('\n')
  }
  if (outcome.status === 'needs-description') {
    return [
      `Rebasing this thread onto \`${bookmark}\` stopped because these revisions have no real description:`,
      ...outcome.revisions.map(revision => `- ${revision.changeId}`),
      'Describe each one with `jj describe -r <change-id> -m "<conventional commit message>"` (split unrelated changes with `jj split` first), then call the `jj_thread_rebase` tool again.',
    ].join('\n')
  }
  return undefined
}

/**
 * One thread workspace can hold several DSH Sessions, so a refusal names the ones actually keeping it busy instead of
 * blaming the thread the user is looking at.
 */
const busyWorkspaceMessage = (blockers: readonly ThreadActivityBlocker[]): string => {
  if (blockers.length === 0) return 'This workspace is still in use. Land once every thread in it is idle.'
  const named = blockers.map(
    blocker => `“${blocker.title ?? blocker.sessionId}” ${blocker.reason === 'working' ? 'is still working' : 'is waiting for an answer'}`,
  )
  return `This workspace is still in use: ${named.join('; ')}. Land once every thread in it is idle.`
}

export class LandingMessages {
  static readonly forResult = landingMessage
}

export interface LandInput {
  readonly path: string
  readonly sessionId: string | undefined
  readonly fromAgent: boolean
  readonly bookmark?: string | undefined
  /** A queued integration's last chance to be cancelled: read once the guard passed, right before the rebase. */
  readonly stillQueued?: Effect.Effect<boolean> | undefined
}

/** Rebases one thread onto its bookmark behind the activity guard, then syncs the checkout and reports the outcome. */
const make = Effect.gen(function* () {
  const threads = yield* ThreadWorkspaces
  const views = yield* RepositoryViews
  const registry = yield* WorkspaceRegistry
  const activity = yield* SessionActivity
  const requests = yield* IntegrationRequests
  const settings = yield* JjSettings
  const sync = yield* WorkspaceSync
  const log = yield* ActivityLog
  const prompt = yield* SessionPrompt
  const path = yield* Path.Path

  const notAThread = new NotAThread({ detail: 'This workspace is not a thread.' })

  const queue = Effect.fn('jj-integration queue land')(function* (input: { readonly path: string; readonly sessionId: string | undefined }) {
    const location = yield* views.bestEffortLocation(input.path)
    if (Option.isNone(location) || location.value.threadName === undefined) return yield* notAThread
    const entry = yield* requests.queue({ path: location.value.workspaceRoot, sessionId: input.sessionId })
    // Queueing changes no jj state, only what the assembled repository views report.
    yield* views.invalidateViews
    yield* log.emit({
      type: 'workspace.integration_queued',
      level: 'routine',
      summary: `Queued integration of ${path.basename(entry.path)} until the thread is idle`,
      path: entry.path,
      sessionId: entry.sessionId,
    })
    return { queuedAt: entry.queuedAt }
  })

  const cancel = Effect.fn('jj-integration cancel queued land')(function* (target: string) {
    const status = yield* requests.cancel(target)
    if (status === 'cancelled') {
      yield* views.invalidateViews
      yield* log.emit({
        type: 'workspace.integration_unqueued',
        level: 'routine',
        summary: `Cancelled the queued integration of ${path.basename(target)}`,
        path: target,
      })
    }
    return { status }
  })

  const askAgent = Effect.fnUntraced(function* (input: { readonly path: string; readonly sessionId: string | undefined; readonly text: string }) {
    const workspace = yield* registry.resolveByPath(input.path)
    const archived = yield* registry.archivedSessionIds
    const target = input.sessionId ?? [...(workspace?.sessionIds ?? [])].reverse().find(candidate => !archived.has(candidate))
    if (target === undefined) return false
    yield* prompt.queue({ sessionId: target, text: input.text })
    return true
  })

  const land = Effect.fn('jj-integration land')(function* (input: LandInput) {
    yield* requests.recordProgress({ path: input.path, phase: 'queued' })
    const bookmark = input.bookmark ?? (yield* settings.get).bookmark
    const correlationId = randomUUID()
    const location = yield* threads.locate(input.path)
    const threadName = location.threadName
    if (threadName === undefined) return yield* notAThread
    const validate = Effect.gen(function* () {
      const workspace = yield* registry.resolveByPath(location.workspaceRoot)
      if (workspace === undefined) return yield* new ThreadActivityUnknown({ detail: 'Could not verify thread activity before rebasing.' })
      const current = yield* activity.guard(workspace.sessionIds)
      const eligible = ThreadRebaseEligibilityModel.eligibility({
        sessionIds: workspace.sessionIds,
        activity: current,
        fromAgent: input.fromAgent,
        sessionId: input.sessionId,
      })
      if (eligible === undefined) {
        // Manual integrations are not dead-ended by an unverifiable activity read: queue the same guarded rebase and let
        // the deferred retry run it once the Host can read idleness. An Agent's own call still reports why it stopped.
        if (!IntegrationRecovery.queuesInsteadOfRefusing({ fromAgent: input.fromAgent, retrying: input.stillQueued !== undefined }))
          return yield* new ThreadActivityUnknown({ detail: 'Could not verify whether this workspace is idle. Refresh and retry integration.' })
        if (input.bookmark !== undefined)
          return yield* new ThreadActivityUnknown({
            detail: 'Could not verify whether this workspace is idle. The selected bookmark was not queued; refresh and retry.',
          })
        yield* queue({ path: input.path, sessionId: input.sessionId })
        return yield* new IntegrationQueued({ path: input.path })
      }
      if (!eligible)
        return yield* new ThreadActive({
          detail: busyWorkspaceMessage(ThreadRebaseEligibilityModel.blockers({ sessionIds: workspace.sessionIds, activity: current })),
        })
      if (input.stillQueued !== undefined && !(yield* input.stillQueued)) return yield* new IntegrationCancelled({ path: input.path })
    })
    const outcome = yield* threads.landAt(
      { ...location, threadName },
      { bookmark, sessionId: input.sessionId, validate, onProgress: phase => requests.recordProgress({ path: input.path, phase }) },
    )
    if (outcome.status === 'landed' || outcome.status === 'nothing-to-land') yield* views.invalidate
    const result: LandResult = {
      status: outcome.status,
      revisions: outcome.status === 'nothing-to-land' ? [] : [...outcome.revisions],
      files: outcome.status === 'conflicted' ? [...outcome.files] : [],
      bookmark,
      agentAsked: false,
      ...(outcome.status === 'landed' && { head: outcome.head }),
    }
    const message = landingMessage(result)
    const agentAsked =
      message !== undefined && !input.fromAgent && (yield* settings.get).askAgentToFixLanding
        ? yield* askAgent({ path: input.path, sessionId: input.sessionId, text: message }).pipe(Effect.orElseSucceed(() => false))
        : false
    if (outcome.status === 'landed')
      yield* sync.enqueue({ repoRoot: location.repoRoot, bookmark, revision: outcome.head.commitId, sessionId: input.sessionId, correlationId })
    yield* log.emit({
      type: `workspace.rebase_${outcome.status.replaceAll('-', '_')}`,
      level: outcome.status === 'landed' || outcome.status === 'nothing-to-land' ? 'notable' : 'attention',
      summary:
        outcome.status === 'landed'
          ? `Rebased ${String(outcome.revisions.length)} revision(s) from ${path.basename(input.path)} onto ${bookmark}`
          : `Rebase ${outcome.status} in ${path.basename(input.path)}`,
      path: input.path,
      sessionId: input.sessionId,
      correlationId,
    })
    return { ...result, agentAsked }
  })

  return { land, queue, cancel }
})

export class Landing extends Context.Service<Landing, Effect.Success<typeof make>>()('@dshfiles/jj-integration/Landing') {
  static readonly layer = Layer.effect(Landing, make)
}
