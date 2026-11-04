import { PluginApiError } from '@dshfiles/dshx/api'
import { Clock, Context, Effect, Layer, Option } from 'effect'
import type { AutomationDraft, AutomationRecord, AutomationView, RunRecord } from './automations-api.js'
import { AutomationProjects, AutomationRunner } from './automation-runner.js'
import { AutomationStore, newAutomationId } from './automation-store.js'
import { PromptTemplate } from './prompt-template.js'
import { ScheduleModel } from './schedule.js'
import { webhookPathOf } from './webhook-route.js'

/** Where the Host web server answers, to turn a webhook path into a URL; null when there is no web server. */
export class AutomationOrigin extends Context.Service<AutomationOrigin, { readonly origin: Effect.Effect<string | null> }>()(
  '@dshfiles/project-automations/AutomationOrigin',
) {}

const notFound = (id: string) =>
  new PluginApiError(`No automation has id ${id}. List automations with automation_list or open DSH › Automations.`, { code: 'automation-not-found' })

const make = Effect.gen(function* () {
  const store = yield* AutomationStore
  const runner = yield* AutomationRunner
  const projects = yield* AutomationProjects
  const origin = yield* AutomationOrigin

  const viewOf = (
    record: AutomationRecord,
    context: { readonly titles: ReadonlyMap<string, string>; readonly origin: string | null; readonly lastRun: RunRecord | null },
  ) => {
    const path = record.trigger.kind === 'webhook' ? webhookPathOf(record.id) : null
    const view: AutomationView = {
      ...record,
      projectTitle: context.titles.get(record.projectId) ?? null,
      schedule: record.trigger.kind === 'schedule' ? ScheduleModel.describe(record.trigger.timing) : null,
      webhookPath: path,
      webhookUrl: path === null || context.origin === null ? null : `${context.origin}${path}`,
      lastRun: context.lastRun,
    }
    return view
  }

  const context = Effect.gen(function* () {
    const rows = yield* projects.list
    return { titles: new Map(rows.map(row => [row.projectId, row.title])), origin: yield* origin.origin }
  })

  const view = Effect.fn('automation view')(function* (record: AutomationRecord) {
    const shared = yield* context
    const [lastRun] = yield* store.runs({ automationId: record.id, limit: 1 })
    return viewOf(record, { ...shared, lastRun: lastRun ?? null })
  })

  const list = Effect.fn('automation list')(function* () {
    const shared = yield* context
    const records = yield* store.automations
    const runs = yield* store.runs({ limit: 500 })
    const latest = new Map<string, RunRecord>()
    for (const run of runs) if (!latest.has(run.automationId)) latest.set(run.automationId, run)
    return { automations: records.map(record => viewOf(record, { ...shared, lastRun: latest.get(record.id) ?? null })) }
  })

  const existing = (id: string) => store.get(id).pipe(Effect.flatMap(found => (Option.isSome(found) ? Effect.succeed(found.value) : Effect.fail(notFound(id)))))

  /** A schedule commits its first target after now; a disabled one keeps no target until it is resumed. */
  const triggerOf = (draft: AutomationDraft['trigger'], enabled: boolean, now: number): Effect.Effect<AutomationRecord['trigger'], PluginApiError> => {
    if (draft.kind === 'webhook') return Effect.succeed({ kind: 'webhook', secretRef: draft.secretRef.trim(), ratePerMinute: draft.ratePerMinute })
    const planned = ScheduleModel.plan(draft.timing, now)
    if (!planned.ok) return Effect.fail(new PluginApiError(`The schedule is not valid: ${planned.message}`, { code: 'invalid-schedule' }))
    return Effect.succeed({ kind: 'schedule', timing: planned.value.timing, nextRunAt: enabled ? planned.value.nextRunAt : null })
  }

  const save = Effect.fn('automation save')(function* (draft: AutomationDraft) {
    const now = yield* Clock.currentTimeMillis
    if (!(yield* projects.list).some(project => project.projectId === draft.projectId))
      return yield* Effect.fail(
        new PluginApiError(`No registered project has id ${draft.projectId}. List projects with automation_projects or open a folder in DSH first.`, {
          code: 'unknown-project',
        }),
      )
    if (draft.trigger.kind === 'webhook') {
      const checked = PromptTemplate.check(draft.prompt)
      if (!checked.ok) return yield* Effect.fail(new PluginApiError(`The prompt template is not valid: ${checked.message}`, { code: 'invalid-template' }))
    }
    const trigger = yield* triggerOf(draft.trigger, draft.enabled, now)
    const record = yield* store.exclusive(
      Effect.gen(function* () {
        const previous = draft.id === undefined ? undefined : yield* existing(draft.id)
        let next: AutomationRecord = {
          id: previous?.id ?? newAutomationId(),
          title: draft.title,
          enabled: draft.enabled,
          projectId: draft.projectId,
          prompt: draft.prompt,
          trigger,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        }
        // A cleared agent preset or model is left out, so the thread uses the Host default.
        if (draft.agentPreset !== undefined) next = { ...next, agentPreset: draft.agentPreset }
        if (draft.model !== undefined) next = { ...next, model: draft.model }
        yield* store.put(next)
        return next
      }),
    )
    return yield* view(record)
  })

  const setEnabled = Effect.fn('automation set enabled')(function* (input: { readonly id: string; readonly enabled: boolean }) {
    const now = yield* Clock.currentTimeMillis
    const record = yield* store.exclusive(
      Effect.gen(function* () {
        const previous = yield* existing(input.id)
        let trigger = previous.trigger
        if (trigger.kind === 'schedule') {
          // Resuming starts from the next target after now: runs missed while paused are not made up.
          const planned = input.enabled ? ScheduleModel.plan(trigger.timing, now) : undefined
          trigger = { ...trigger, nextRunAt: planned?.ok === true ? planned.value.nextRunAt : null }
        }
        const next: AutomationRecord = { ...previous, enabled: input.enabled, trigger, updatedAt: now }
        yield* store.put(next)
        return next
      }),
    )
    return yield* view(record)
  })

  const runNow = Effect.fn('automation run now')(function* (input: { readonly id: string }) {
    const automation = yield* existing(input.id)
    const prompt =
      automation.trigger.kind === 'webhook'
        ? `${PromptTemplate.fill(automation.prompt, { body: null, headers: {} })}${PromptTemplate.framing(automation.title, [])}`
        : automation.prompt
    return yield* runner.start({ automation, trigger: 'manual', prompt })
  })

  const remove = Effect.fn('automation delete')(function* (input: { readonly id: string }) {
    return { deleted: yield* store.exclusive(store.remove(input.id)) }
  })

  const runs = (input: { readonly automationId?: string | undefined; readonly limit: number }) => store.runs(input).pipe(Effect.map(rows => ({ runs: rows })))

  return { list, save, setEnabled, runNow, remove, runs, projects: projects.list.pipe(Effect.map(rows => ({ projects: rows }))) }
})

/** The handlers behind every automations API method and agent tool. */
export class AutomationsService extends Context.Service<AutomationsService, Effect.Success<typeof make>>()('@dshfiles/project-automations/AutomationsService') {
  static readonly layer = Layer.effect(AutomationsService, make)
}
