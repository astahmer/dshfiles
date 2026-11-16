import type { Api } from '@dshfiles/dshx/effect'
import type { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { VcsProviderService } from '@dshfiles/vcs-provider-port/effect'
import { Clock, Context, Effect, Layer, Option } from 'effect'
import type { AutomationDestination, AutomationRecord, RunRecord } from './automations-api.js'
import { AutomationStore, newRunId, type AutomationStorageFailure } from './automation-store.js'

/** The session controller's API: the native path that starts a thread, as the New thread button does. */
export class AutomationSessions extends Context.Service<AutomationSessions, Api.TypedApiClient<(typeof sessionsApi)['methods']>>()(
  '@dshfiles/project-automations/AutomationSessions',
) {}

export interface ProjectRow {
  readonly projectId: string
  readonly title: string
  readonly path: string
}

/** Registered projects (DSH Workspaces), read from the Host's workspace registry on each call. */
export class AutomationProjects extends Context.Service<AutomationProjects, { readonly list: Effect.Effect<readonly ProjectRow[]> }>()(
  '@dshfiles/project-automations/AutomationProjects',
) {}

export type RunTrigger = RunRecord['trigger']

/** What a run asks the session controller for; optional fields are set only when the automation names them. */
interface CreateRequest {
  projectId: string
  title: string
  prompt: string
  agentPreset?: string
  model?: NonNullable<AutomationRecord['model']>
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Why a start failed, written for the person reading the run history, with what to do next. */
const startFailure = (error: { readonly _tag: string; readonly message: string; readonly ownerMissing?: boolean }): string => {
  if (error._tag === 'ApiUnavailableError' && error.ownerMissing === true)
    return 'No thread started: the session controller plugin (@dshfiles/session-controller) is not loaded. Add it to this DSH profile and restart DSH, then use Run now.'
  if (error._tag === 'ApiRemoteError' || error._tag === 'ApiContractError')
    return `No thread started: ${clip(error.message, 300)} Check the project, agent preset and model of this automation, then use Run now.`
  return 'No thread started: the session controller did not answer. Try Run now; if it keeps failing, read the Host log for @dshfiles/session-controller.'
}

type Placed = { readonly ok: true; readonly workspaceId: string } | { readonly ok: false; readonly detail: string }

const make = Effect.gen(function* () {
  const store = yield* AutomationStore
  const sessions = yield* AutomationSessions
  const projects = yield* AutomationProjects
  const vcs = yield* VcsProviderService

  /**
   * The workspace a run's new thread edits: the project checkout, as automations always ran, or a new workspace of its
   * own that the version-control provider claiming the project cuts from `base`. An unattended run never falls back to
   * the checkout when it asked for a workspace of its own: it fails and says why.
   */
  const placeNewThread = Effect.fn('automation workspace')(function* (project: ProjectRow, destination: AutomationDestination | undefined) {
    if (destination?.kind !== 'new-thread' || destination.isolate !== true) return { ok: true, workspaceId: project.projectId } satisfies Placed
    const base = destination.base
    const from = base === undefined ? '' : ` from "${base}"`
    const provider = yield* vcs.resolve({ path: project.path })
    if (Option.isNone(provider))
      return {
        ok: false,
        detail: `No thread started: ${project.path} is not a jj or git repository DSH can read, so the thread cannot get a workspace of its own${from}. Enable Jujutsu (jj-integration) or git-worktrees for the project, or edit the automation to run in the project checkout, then use Run now.`,
      } satisfies Placed
    return yield* provider.value.client.provision(base === undefined ? { workspaceId: project.projectId, isolate: true } : { workspaceId: project.projectId, isolate: true, base }).pipe(
      Effect.map((provisioned): Placed => ({ ok: true, workspaceId: provisioned.workspaceId })),
      Effect.catch(error =>
        Effect.succeed<Placed>({
          ok: false,
          detail: `No thread started: its workspace${from} could not be created: ${clip(error.message, 300)} Edit the automation to start from another bookmark or in the project checkout, then use Run now.`,
        }),
      ),
    )
  })

  /**
   * Start one run: a new thread in the automation's project with the given prompt. The run is recorded whatever the
   * outcome, so the history shows a failed start with its reason. One span per run, identities and outcome only.
   */
  const start = Effect.fn('automation run')(function* (input: {
    readonly automation: AutomationRecord
    readonly trigger: RunTrigger
    readonly prompt: string
    readonly occurrenceAt?: string | undefined
  }) {
    const { automation } = input
    const startedAt = yield* Clock.currentTimeMillis
    yield* Effect.annotateCurrentSpan({ 'dshx.automation.id': automation.id, 'dshx.automation.trigger': input.trigger })
    const project = (yield* projects.list).find(candidate => candidate.projectId === automation.projectId)
    const destination = automation.destination
    yield* Effect.annotateCurrentSpan({
      'dshx.automation.checkout': destination?.kind === 'new-thread' && destination.isolate === true ? 'own' : 'in-place',
    })
    const createIn = (workspaceId: string) => {
      const request: CreateRequest = { projectId: workspaceId, title: automation.title, prompt: input.prompt }
      if (automation.agentPreset !== undefined) request.agentPreset = automation.agentPreset
      if (automation.model !== undefined) request.model = automation.model
      return sessions.create(request).pipe(
        Effect.map(result => ({ ok: true as const, sessionId: result.sessionId })),
        Effect.catch(error => Effect.succeed({ ok: false as const, detail: startFailure(error) })),
      )
    }
    const created =
      destination?.kind === 'existing-thread'
        ? yield* sessions.prompt({ sessionId: destination.sessionId, text: input.prompt, mode: 'queue' }).pipe(
            Effect.map(() => ({ ok: true as const, sessionId: destination.sessionId })),
            Effect.catch(error =>
              Effect.succeed({
                ok: false as const,
                detail: `${startFailure(error)} This automation posts into thread ${destination.sessionId}: edit it with automation_save, or start a new thread instead.`,
              }),
            ),
          )
        : project !== undefined
          ? yield* placeNewThread(project, destination).pipe(
              Effect.flatMap(placed => (placed.ok ? createIn(placed.workspaceId) : Effect.succeed({ ok: false as const, detail: placed.detail }))),
            )
          : {
              ok: false as const,
              detail:
                'No thread started: this automation’s project is no longer registered in DSH. Edit the automation and choose a project, or add the folder again.',
            }
    const finishedAt = yield* Clock.currentTimeMillis
    let run: RunRecord = {
      id: newRunId(),
      automationId: automation.id,
      automationTitle: automation.title,
      trigger: input.trigger,
      outcome: created.ok ? 'started' : 'failed',
      startedAt,
      finishedAt,
    }
    if (input.occurrenceAt !== undefined) run = { ...run, occurrenceAt: input.occurrenceAt }
    run = created.ok ? { ...run, sessionId: created.sessionId } : { ...run, detail: created.detail }
    yield* Effect.annotateCurrentSpan({ 'dshx.automation.outcome': run.outcome })
    yield* store.recordRun(run)
    return run
  })

  /** Record a webhook request refused before any thread started (bad signature, rate limit, paused, missing secret). */
  const reject = Effect.fn('automation run reject')(function* (input: { readonly automation: AutomationRecord; readonly detail: string }) {
    const at = yield* Clock.currentTimeMillis
    const run: RunRecord = {
      id: newRunId(),
      automationId: input.automation.id,
      automationTitle: input.automation.title,
      trigger: 'webhook',
      outcome: 'rejected',
      startedAt: at,
      finishedAt: at,
      detail: input.detail,
    }
    yield* store.recordRun(run)
    return run
  })

  return AutomationRunner.of({ start, reject })
})

export class AutomationRunner extends Context.Service<
  AutomationRunner,
  {
    readonly start: (input: {
      readonly automation: AutomationRecord
      readonly trigger: RunTrigger
      readonly prompt: string
      readonly occurrenceAt?: string | undefined
    }) => Effect.Effect<RunRecord, AutomationStorageFailure>
    readonly reject: (input: { readonly automation: AutomationRecord; readonly detail: string }) => Effect.Effect<RunRecord, AutomationStorageFailure>
  }
>()('@dshfiles/project-automations/AutomationRunner') {
  static readonly layer = Layer.effect(AutomationRunner, make)
}
