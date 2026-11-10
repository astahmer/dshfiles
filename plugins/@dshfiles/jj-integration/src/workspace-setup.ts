import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { projectChecksApi } from '@dshfiles/project-checks/api'
import { createHash } from 'node:crypto'
import { Context, Effect, Layer, Option } from 'effect'
import type { WorkspaceSetup, WorkspaceSetupTask } from './api.js'
import { WorkspaceRegistry } from './host-edges-promise.js'
import { ThreadWorkspaces } from './thread-workspaces.js'

const PHASES = {
  queued: 'queued',
  'resolving-workspace': 'resolving',
  'starting-process': 'starting',
  'recording-result': 'recording',
  reconciling: 'reconciling',
} as const

/**
 * A dispatch key the queue resolves to one task: re-asking for the same workspace and action (a reloaded page, a second
 * tab, a lost response) reuses the run instead of starting another install.
 */
const idempotencyKey = (input: {
  readonly kind: 'create' | 'settle'
  readonly sessionId: string
  readonly actionId: string
  readonly path: string
}): string => {
  const digest = createHash('sha256').update(`${input.kind}\0${input.sessionId}\0${input.actionId}\0${input.path}`).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}

const empty: WorkspaceSetup = { tasks: [], awaitsFirstTurn: false, applies: false }

/**
 * Runs the trusted actions a project flagged to prepare a fresh thread workspace, and the ones flagged for settle.
 *
 * Both go through Project Checks' durable task queue: this only selects them (its trusted-root rule refuses to widen a
 * root to reach a workspace created beside the checkout) and dispatches them idempotently. Nothing declared in
 * `dsh.project.json` can add, change or run an action here; only the profile-trusted configuration decides.
 */
export class WorkspaceSetupService extends Context.Service<
  WorkspaceSetupService,
  {
    readonly ensure: (input: { readonly sessionId: string; readonly path: string }) => Effect.Effect<WorkspaceSetup>
    readonly cancel: (input: { readonly sessionId: string; readonly taskId: string }) => Effect.Effect<WorkspaceSetup>
    readonly onSettle: (input: { readonly sessionIds: readonly string[] }) => Effect.Effect<void>
  }
>()('@dshfiles/jj-integration/WorkspaceSetup') {
  static readonly layer = Layer.effect(
    WorkspaceSetupService,
    Effect.gen(function* () {
      const threads = yield* ThreadWorkspaces
      const registry = yield* WorkspaceRegistry
      const projectChecks = (yield* HostApis).client(projectChecksApi)

      const tasksFor = Effect.fnUntraced(function* (input: { readonly sessionId: string; readonly actionIds: ReadonlySet<string> }) {
        // A Host without a readable queue has nothing to show, and holding a first turn for it would strand the thread.
        const listed = yield* projectChecks
          .tasks({ sessionId: input.sessionId })
          .pipe(Effect.catch(error => Effect.logWarning(`jj-integration: could not read workspace setup tasks: ${String(error)}`).pipe(Effect.as([]))))
        return listed
          .filter(task => input.actionIds.has(task.actionId))
          .map((task): WorkspaceSetupTask => ({
            id: task.id,
            actionId: task.actionId,
            label: task.label,
            status: task.status,
            phase: PHASES[task.progress],
          }))
      })

      const dispatch = (input: {
        readonly kind: 'create' | 'settle'
        readonly sessionId: string
        readonly actionIds: readonly string[]
        readonly path: string
      }) =>
        Effect.forEach(
          input.actionIds,
          actionId =>
            projectChecks
              .dispatch({
                sessionId: input.sessionId,
                actionId,
                idempotencyKey: idempotencyKey({ kind: input.kind, sessionId: input.sessionId, actionId, path: input.path }),
              })
              .pipe(Effect.asVoid),
          { concurrency: 1, discard: true },
        ).pipe(Effect.catch(error => Effect.logWarning(`jj-integration: could not dispatch a workspace setup action: ${String(error)}`)))

      /**
       * The actions a repository flagged for this workspace. Project Checks answers with the ones whose trusted root
       * spans both the checkout and the workspace, so a Host that cannot answer (or an older one without this read)
       * simply runs nothing.
       */
      const selection = Effect.fnUntraced(function* (workspacePath: string) {
        const located = yield* threads.locate(workspacePath).pipe(Effect.option)
        if (Option.isNone(located) || located.value.threadName === undefined) return undefined
        const actions = yield* projectChecks.setupActions({ workspacePath: located.value.workspaceRoot, repoRoot: located.value.repoRoot }).pipe(
          Effect.map(Option.some),
          Effect.catch(() => Effect.succeed(Option.none())),
        )
        if (Option.isNone(actions) || actions.value.length === 0) return undefined
        return { actions: actions.value, workspace: located.value }
      })

      const ensure = Effect.fn('jj-integration workspace setup')(function* (input: { readonly sessionId: string; readonly path: string }) {
        const found = yield* selection(input.path)
        if (found === undefined) return empty
        const create = found.actions.filter(action => action.runOnWorkspaceCreate)
        if (create.length > 0)
          yield* dispatch({ kind: 'create', sessionId: input.sessionId, actionIds: create.map(action => action.id), path: found.workspace.workspaceRoot })
        const tasks = yield* tasksFor({ sessionId: input.sessionId, actionIds: new Set(found.actions.map(action => action.id)) })
        return { tasks, awaitsFirstTurn: create.some(action => action.awaitBeforeFirstTurn), applies: true } satisfies WorkspaceSetup
      })

      const cancel = Effect.fn('jj-integration workspace setup cancel')(function* (input: { readonly sessionId: string; readonly taskId: string }) {
        const cancelled = yield* projectChecks.cancelTask({ sessionId: input.sessionId, taskId: input.taskId }).pipe(
          Effect.map(Option.some),
          Effect.catch(error => Effect.logWarning(`jj-integration: could not cancel workspace setup: ${String(error)}`).pipe(Effect.as(Option.none()))),
        )
        if (Option.isNone(cancelled)) return empty
        const task: WorkspaceSetupTask = {
          id: cancelled.value.id,
          actionId: cancelled.value.actionId,
          label: cancelled.value.label,
          status: cancelled.value.status,
          phase: PHASES[cancelled.value.progress],
        }
        return { tasks: [task], awaitsFirstTurn: false, applies: true } satisfies WorkspaceSetup
      })

      /** A thread settled: run the actions flagged for that in the workspace the settled Sessions work in. */
      const runSettle = Effect.fn('jj-integration workspace setup on settle')(function* (input: { readonly sessionIds: readonly string[] }) {
        const settled = new Set(input.sessionIds)
        const workspaces = (yield* registry.list).filter(workspace => workspace.sessionIds.map(String).some(sessionId => settled.has(sessionId)))
        yield* Effect.forEach(
          workspaces,
          workspace =>
            Effect.gen(function* () {
              const found = yield* selection(workspace.path)
              if (found === undefined) return
              const settle = found.actions.filter(action => action.onSettle)
              if (settle.length === 0) return
              const sessionId = workspace.sessionIds.map(String).find(candidate => settled.has(candidate))
              if (sessionId === undefined) return
              yield* dispatch({ kind: 'settle', sessionId, actionIds: settle.map(action => action.id), path: found.workspace.workspaceRoot })
            }),
          { concurrency: 1, discard: true },
        )
      })

      // A settle trigger is best effort: it must never fail the settings event that started it.
      const onSettle = (input: { readonly sessionIds: readonly string[] }) =>
        runSettle(input).pipe(Effect.catch(error => Effect.logWarning(`jj-integration: settle workspace setup failed: ${String(error)}`)))

      return WorkspaceSetupService.of({ ensure, cancel, onSettle })
    }),
  )
}
