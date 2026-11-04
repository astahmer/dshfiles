import type { Api } from '@dshfiles/dshx/effect'
import type { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Clock, Context, Effect, Layer } from 'effect'
import type { AutomationRecord, RunRecord } from './automations-api.js'
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

const make = Effect.gen(function* () {
  const store = yield* AutomationStore
  const sessions = yield* AutomationSessions
  const projects = yield* AutomationProjects

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
    const known = (yield* projects.list).some(project => project.projectId === automation.projectId)
    const request: CreateRequest = { projectId: automation.projectId, title: automation.title, prompt: input.prompt }
    if (automation.agentPreset !== undefined) request.agentPreset = automation.agentPreset
    if (automation.model !== undefined) request.model = automation.model
    const created = known
      ? yield* sessions.create(request).pipe(
          Effect.map(result => ({ ok: true as const, sessionId: result.sessionId })),
          Effect.catch(error => Effect.succeed({ ok: false as const, detail: startFailure(error) })),
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
