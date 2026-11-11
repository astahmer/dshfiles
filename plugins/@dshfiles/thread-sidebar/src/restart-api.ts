import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const count = Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
const instant = Schema.NullOr(Schema.Number.check(Schema.isFinite()))

const autoRestartStatusSchema = Schema.Struct({
  phase: Schema.Literals(['none', 'disabled', 'unsupervised', 'postponed', 'waiting', 'quiet', 'countdown', 'restarting']),
  enabled: Schema.Boolean,
  updates: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(256)),
  busy: Schema.Struct({ turns: count, jobs: count, questions: count }),
  quietSeconds: count,
  restartAt: instant,
  postponedUntil: instant,
  command: Schema.NullOr(Schema.String),
  /** This Host process, so a page can tell the Host that replaced it after the automatic restart. */
  run: Schema.String,
})

export type AutoRestartStatusWire = typeof autoRestartStatusSchema.Type

const describeAutoRestart = (status: AutoRestartStatusWire): string => {
  const updates = status.updates.length === 0 ? 'no update waits for a restart' : `waiting: ${status.updates.join(', ')}`
  const busy = `${String(status.busy.turns)} running turn(s), ${String(status.busy.jobs)} background job(s), ${String(status.busy.questions)} open question(s)`
  if (status.phase === 'unsupervised')
    return `Automatic restart unavailable: no supervisor. ${updates}. Start DSH with ${status.command ?? 'the supervised launcher'}.`
  if (status.phase === 'postponed') return `Automatic restart postponed until ${new Date(status.postponedUntil ?? 0).toISOString()}; ${updates}.`
  if (status.phase === 'quiet' || status.phase === 'countdown')
    return `Automatic restart at ${new Date(status.restartAt ?? 0).toISOString()} if DSH stays idle; ${updates}.`
  return `Automatic restart ${status.phase}${status.enabled ? '' : ' (setting off)'}; ${updates}; ${busy}.`
}

export const threadSidebarRestartApi = defineApi({
  id: 'thread-sidebar-restart',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    availability: method({
      input: Schema.Void,
      output: Schema.Struct({
        available: Schema.Boolean,
        /** This Host process; a new value after a restart tells the page the new Host is up. Absent on older Hosts. */
        run: Schema.optional(Schema.String),
        /** A restart waiting for running turns to finish: since when, and how many turns are still running. */
        pending: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              since: Schema.Number.check(Schema.isFinite()),
              running: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
            }),
          ),
        ),
      }),
    }),
    requestRestart: method({ input: Schema.Void, output: Schema.Struct({ accepted: Schema.Literal(true) }) }),
    /** Restart once no turn is running (or after a long wait), so working threads finish instead of being cut off. */
    requestRestartWhenIdle: method({ input: Schema.Void, output: Schema.Struct({ accepted: Schema.Literal(true) }) }),
    cancelPendingRestart: method({ input: Schema.Void, output: Schema.Struct({ canceled: Schema.Boolean }) }),
    autoRestartStatus: method({
      input: Schema.Struct({}),
      output: autoRestartStatusSchema,
      description:
        'The automatic restart that applies pending Host updates once DSH is idle: its phase, the pending updates, what keeps DSH busy, when it would restart and any postponement. Read-only.',
      tool: { name: 'auto_restart_status', readOnly: true, render: describeAutoRestart },
    }),
    postponeAutoRestart: method({
      input: Schema.Struct({
        minutes: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(1440))),
      }),
      output: Schema.Struct({ postponedUntil: Schema.Number.check(Schema.isFinite()) }),
      description:
        'Hold the automatic DSH restart for some minutes (default 60); the updates stay pending. Run only when the user asked to postpone the restart. Reverse with resumeAutoRestart.',
      tool: { name: 'auto_restart_postpone', render: output => `Automatic restart postponed until ${new Date(output.postponedUntil).toISOString()}.` },
    }),
    resumeAutoRestart: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ resumed: Schema.Boolean }),
      description: 'Drop a postponement of the automatic DSH restart. Run only when the user asked to let it restart again.',
      tool: {
        name: 'auto_restart_resume',
        render: output => (output.resumed ? 'Automatic restart may run again.' : 'The automatic restart was not postponed.'),
      },
    }),
    /** The tokenized launch URL the dsh-web supervisor recorded, to hand to an agent or `dshx`. */
    launchUrl: method({ input: Schema.Void, output: Schema.Struct({ url: Schema.NullOr(Schema.String) }) }),
  },
})
