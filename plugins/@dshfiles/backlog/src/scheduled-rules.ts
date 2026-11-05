import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { automationsApi, timingSchema } from '@dshfiles/project-automations/api'
import { Context, Effect, Layer } from 'effect'
import { BacklogReference } from './backlog-reference.js'
import { BacklogAutomationsUnavailable, BacklogItemNotFound } from './errors.js'
import { BacklogItems } from './item.js'
import { BacklogStore } from './store.js'

/** A schedule as project-automations takes it: cron, daily, weekly or every, with an explicit IANA time zone. */
export type RuleTiming = typeof timingSchema.Type

/** What a scheduled backlog rule does on each run, as the prompt of the thread project-automations starts. */
const triagePrompt = (project: string): string =>
  [
    `Scheduled backlog triage for the project at ${project}.`,
    'Call backlog_triage_backfill with limit 25 and confirm: true: this automation is the user asking for it.',
    'Then call backlog_list with inbox: true and project set to that path, and reply with one line per item still waiting on the user.',
    'Change nothing else.',
  ].join('\n')

const recreatePrompt = (item: { readonly ref: string; readonly title: string; readonly project: string | null }): string =>
  [
    `Scheduled backlog item: recreate ${BacklogReference.label(item.ref)} (${item.title}).`,
    `Call backlog_get for ${BacklogReference.label(item.ref)}, then backlog_capture a new item with the same title, kind, priority and project${item.project === null ? '' : ` (${item.project})`}, its body, and a line "Recurs from ${BacklogReference.label(item.ref)}".`,
    'Reply with the new item reference. Change nothing else.',
  ].join('\n')

/**
 * Backlog rules that run on a schedule, composed on `@dshfiles/project-automations` rather than a scheduler of our own:
 * each rule is an automation of the item's project whose prompt calls backlog tools. Without that plugin the call fails
 * with a recovery instead of pretending to schedule.
 */
export class ScheduledRules extends Context.Service<
  ScheduledRules,
  {
    readonly schedule: (input: {
      readonly rule: 'triage' | 'recreate'
      readonly project?: string | undefined
      readonly id?: number | undefined
      readonly timing: RuleTiming
    }) => Effect.Effect<
      { readonly automationId: string; readonly title: string; readonly schedule: string | null; readonly projectTitle: string | null },
      BacklogAutomationsUnavailable | BacklogItemNotFound
    >
  }
>()('@dshfiles/backlog/ScheduledRules') {
  static readonly layer = Layer.effect(
    ScheduledRules,
    Effect.gen(function* () {
      const apis = yield* HostApis
      const store = yield* BacklogStore
      const client = apis.client(automationsApi)
      const unavailable = (reason: string) => new BacklogAutomationsUnavailable({ reason })

      const schedule = Effect.fn('backlog scheduled rule')(function* (input: {
        readonly rule: 'triage' | 'recreate'
        readonly project?: string | undefined
        readonly id?: number | undefined
        readonly timing: RuleTiming
      }) {
        if (!(yield* apis.isServed(automationsApi))) return yield* unavailable('the Project automations plugin is not loaded')
        const found = input.id === undefined ? undefined : yield* store.get(input.id)
        if (input.id !== undefined && found?.ok !== true) return yield* new BacklogItemNotFound({ ids: [input.id] })
        const item = found?.ok === true ? found.value.item : undefined
        const project = BacklogItems.projectOf(input.project ?? item?.project ?? null)
        if (project === null) return yield* unavailable('the rule needs a project: pick one for the item, or pass project')
        const projects = (yield* client.projects({}).pipe(Effect.mapError(error => unavailable(error.message)))).projects
        const target = projects.find(candidate => BacklogItems.projectPath(candidate.path) === project)
        if (target === undefined) return yield* unavailable(`${project} is not a registered project; register it in DSH first`)
        const prompt =
          input.rule === 'triage' || item === undefined
            ? triagePrompt(project)
            : recreatePrompt({ ref: BacklogReference.refOf(item), title: item.title, project: item.project })
        const title = input.rule === 'triage' || item === undefined ? `Backlog triage · ${target.title}` : `Recreate ${BacklogReference.labelOf(item)}`
        const saved = yield* client
          .save({ title: title.slice(0, 120), projectId: target.projectId, prompt, enabled: true, trigger: { kind: 'schedule', timing: input.timing } })
          .pipe(Effect.mapError(error => unavailable(error.message)))
        return { automationId: saved.id, title: saved.title, schedule: saved.schedule, projectTitle: saved.projectTitle }
      })

      return ScheduledRules.of({ schedule })
    }),
  )
}
