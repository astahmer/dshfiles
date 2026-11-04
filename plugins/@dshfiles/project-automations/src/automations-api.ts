import { defineApi, method } from '@dshfiles/dshx/api'
import { Effect, Schema } from 'effect'

const ONLY_WHEN_ASKED = 'Call only when the user asked for this.'

const automationId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^auto_[A-Za-z0-9_-]{8,40}$/u))
const timeZone = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const localTime = Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/u, { message: 'Use a 24-hour HH:mm or HH:mm:ss local time.' }))

export const timingSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('cron'), expression: Schema.Trim.check(Schema.isMinLength(9), Schema.isMaxLength(200)), timeZone }),
  Schema.Struct({ kind: Schema.Literal('daily'), time: localTime, timeZone }),
  Schema.Struct({
    kind: Schema.Literal('weekly'),
    time: localTime,
    timeZone,
    weekdays: Schema.Array(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(7))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(7),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('every'),
    everySeconds: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(60), Schema.isLessThanOrEqualTo(31_622_400)),
  }),
])

export const modelSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(400)),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
})

const secretReference = Schema.Trim.check(
  Schema.isMaxLength(4096),
  Schema.isPattern(/^secret:[A-Za-z_][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?$/u, {
    message: 'Store the webhook secret as a secret:ALIAS reference from the Secret Catalog, never the value itself.',
  }),
)

const ratePerMinute = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(120))

export const triggerDraftSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('schedule'), timing: timingSchema }),
  Schema.Struct({
    kind: Schema.Literal('webhook'),
    secretRef: secretReference,
    ratePerMinute: ratePerMinute.pipe(Schema.withDecodingDefault(Effect.succeed(10))),
  }),
])

export const triggerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('schedule'), timing: timingSchema, nextRunAt: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('webhook'), secretRef: Schema.String, ratePerMinute }),
])

/** One stored automation. The webhook secret is a `secret:ALIAS` reference; its value is resolved per request. */
export const automationRecordSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  enabled: Schema.Boolean,
  projectId: Schema.String,
  prompt: Schema.String,
  agentPreset: Schema.optional(Schema.String),
  model: Schema.optional(modelSchema),
  trigger: triggerSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type AutomationRecord = typeof automationRecordSchema.Type

export const runTriggerSchema = Schema.Literals(['schedule', 'webhook', 'manual'])
export const runOutcomeSchema = Schema.Literals(['started', 'failed', 'rejected'])

/** One run: a thread started, a start that failed, or a webhook request refused before any thread. */
export const runRecordSchema = Schema.Struct({
  id: Schema.String,
  automationId: Schema.String,
  automationTitle: Schema.String,
  trigger: runTriggerSchema,
  outcome: runOutcomeSchema,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
  occurrenceAt: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  /** A user-facing reason with the next step; never a secret, a payload or raw transport text. */
  detail: Schema.optional(Schema.String),
})
export type RunRecord = typeof runRecordSchema.Type

export const automationViewSchema = Schema.Struct({
  ...automationRecordSchema.fields,
  projectTitle: Schema.NullOr(Schema.String),
  schedule: Schema.NullOr(Schema.String),
  webhookPath: Schema.NullOr(Schema.String),
  webhookUrl: Schema.NullOr(Schema.String),
  lastRun: Schema.NullOr(runRecordSchema),
})
export type AutomationView = typeof automationViewSchema.Type

const title = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120))
const prompt = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(20_000))

export const automationDraftSchema = Schema.Struct({
  id: Schema.optional(automationId),
  title,
  projectId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  prompt,
  agentPreset: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  model: Schema.optional(modelSchema),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  trigger: triggerDraftSchema,
})
export type AutomationDraft = typeof automationDraftSchema.Type

const listOutput = Schema.Struct({ automations: Schema.Array(automationViewSchema) })

/**
 * Project automations: schedules and signed webhooks that each start a new thread in a project. Every user verb in
 * the Automations page is a method here, and each one the agent may use carries its tool.
 */
export const automationsApi = defineApi({
  id: 'project-automations',
  version: 1,
  owner: '@dshfiles/project-automations',
  methods: {
    list: method({
      description:
        'Every project automation with its trigger (schedule with next run, or webhook URL), project, prompt, agent preset, model, enabled state and latest run. Read-only.',
      input: Schema.Struct({}),
      output: listOutput,
      readOnly: true,
      tool: { name: 'automation_list', readOnly: true },
    }),
    runs: method({
      description: 'Recent automation runs, newest first, with trigger, outcome, the started thread id and the reason a run failed or was refused. Read-only.',
      input: Schema.Struct({
        automationId: Schema.optional(automationId),
        limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)).pipe(
          Schema.withDecodingDefault(Effect.succeed(20)),
        ),
      }),
      output: Schema.Struct({ runs: Schema.Array(runRecordSchema) }),
      readOnly: true,
      tool: { name: 'automation_runs', readOnly: true },
    }),
    projects: method({
      description: 'Registered projects an automation can start threads in, with the projectId automation_save takes. Read-only.',
      input: Schema.Struct({}),
      output: Schema.Struct({ projects: Schema.Array(Schema.Struct({ projectId: Schema.String, title: Schema.String, path: Schema.String })) }),
      readOnly: true,
      tool: { name: 'automation_projects', readOnly: true },
    }),
    save: method({
      description: `Create a project automation (omit id) or replace one (pass its id). A schedule trigger takes cron, daily, weekly or every timing with an explicit IANA time zone; a webhook trigger takes the HMAC secret as a secret:ALIAS reference and a per-minute rate limit. Each run starts a new thread in the project with the prompt; a webhook prompt may read {{body.path}} and {{headers.name}}. ${ONLY_WHEN_ASKED}`,
      input: automationDraftSchema,
      output: automationViewSchema,
      tool: { name: 'automation_save', readOnly: false },
    }),
    setEnabled: method({
      description: `Pause (enabled false) or resume an automation. A resumed schedule runs from its next target after now; runs missed while paused are not made up. ${ONLY_WHEN_ASKED}`,
      input: Schema.Struct({ id: automationId, enabled: Schema.Boolean }),
      output: automationViewSchema,
      tool: { name: 'automation_set_enabled', readOnly: false },
    }),
    runNow: method({
      description: `Start one run of an automation now: a new thread in its project with its prompt (webhook placeholders render empty). Its schedule is unchanged. ${ONLY_WHEN_ASKED}`,
      input: Schema.Struct({ id: automationId }),
      output: runRecordSchema,
      tool: { name: 'automation_run_now', readOnly: false },
    }),
    delete: method({
      description: `Delete an automation and its run history; its webhook URL stops answering. Threads it started are kept. Requires confirm: true. ${ONLY_WHEN_ASKED}`,
      input: Schema.Struct({ id: automationId, confirm: Schema.Literal(true) }),
      output: Schema.Struct({ deleted: Schema.Boolean }),
      tool: { name: 'automation_delete', readOnly: false },
    }),
  },
})
