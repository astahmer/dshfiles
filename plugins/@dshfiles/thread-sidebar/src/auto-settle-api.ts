import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))

const settleReasonSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200))

const settleSourceSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(120))

const settleEntrySchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    sessionId: sessionIdSchema,
    reason: settleReasonSchema,
    source: settleSourceSchema,
    at: Schema.Number.check(Schema.isFinite()),
  }),
)

const scanSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    at: Schema.Number.check(Schema.isFinite()),
    durationMs: Schema.Number.check(Schema.isFinite()),
    idleSettled: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
    rebasedSettled: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
    /** Absent from a Host that predates the subagent trigger. */
    subagentSettled: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
    jobsStopped: Schema.optional(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
    error: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  }),
)

const skipSchema = Schema.Literals(['unknown', 'running', 'running-descendant', 'pending-question', 'blank', 'archived', 'pinned', 'opted-out'])

export const autoSettleStatusSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    /** The Host scans on its own; a browser with this answer runs no scan of its own. */
    hostScan: Schema.Literal(true),
    /** Whether idle or rebased auto-settle is switched on in the sidebar settings. */
    active: Schema.Boolean,
    intervalMinutes: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThan(0)),
    nextScanAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
    lastScan: Schema.NullOr(scanSchema),
    /** The newest automatic settles, newest first, with the trigger that asked for each. */
    recent: Schema.Array(settleEntrySchema).check(Schema.isMaxLength(50)),
  }),
)

export type AutoSettleStatus = Schema.Schema.Type<typeof autoSettleStatusSchema>

export const settleRequestResultSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    results: Schema.Array(
      SchemaHelpers.strictStruct(
        Schema.Struct({
          sessionId: sessionIdSchema,
          outcome: Schema.Literals(['settled', 'already-settled', 'skipped']),
          skipReason: Schema.optional(skipSchema),
        }),
      ),
    ),
  }),
)

export type SettleRequestResult = Schema.Schema.Type<typeof settleRequestResultSchema>

const renderStatus = (status: AutoSettleStatus): string => {
  const lines = [
    status.active ? `Auto-settle is on; the Host checks every ${String(status.intervalMinutes)} min.` : 'Auto-settle is off in the thread-sidebar settings.',
  ]
  if (status.lastScan !== null) {
    const scan = status.lastScan
    lines.push(
      scan.error === undefined
        ? `Last scan ${new Date(scan.at).toISOString()}: ${String(scan.idleSettled)} idle, ${String(scan.rebasedSettled)} rebased and ${String(scan.subagentSettled ?? 0)} subagent threads settled; ${String(scan.jobsStopped ?? 0)} subagent jobs stopped.`
        : `Last scan ${new Date(scan.at).toISOString()} failed: ${scan.error}`,
    )
  }
  if (status.nextScanAt !== null) lines.push(`Next scan ${new Date(status.nextScanAt).toISOString()}.`)
  for (const entry of status.recent.slice(0, 10)) lines.push(`${new Date(entry.at).toISOString()} · ${entry.sessionId} · ${entry.source}: ${entry.reason}`)
  return lines.join('\n')
}

/**
 * Host-owned settling. The thread sidebar's Host scans for idle and rebased threads with no browser open, and
 * other plugins ask it to settle a thread for their own reason (a pull request merged or closed, for example)
 * through `requestSettle`, instead of writing the settled status themselves.
 */
export const threadSidebarAutoSettleApi = defineApi({
  id: 'thread-sidebar-auto-settle',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    status: method({
      input: SchemaHelpers.strictStruct(Schema.Struct({})),
      output: autoSettleStatusSchema,
      description:
        'Read the Host auto-settle state: whether idle or rebased auto-settle is on, the scan interval, the last and next scan, and the newest automatic settles with the trigger and reason behind each. Read-only.',
      tool: { name: 'thread_auto_settle_status', readOnly: true, render: renderStatus },
    }),
    requestSettle: method({
      input: SchemaHelpers.strictStruct(
        Schema.Struct({
          sessionIds: Schema.Array(sessionIdSchema).check(Schema.isMinLength(1)).check(Schema.isMaxLength(100)),
          /** Why the thread should settle, shown with the automatic settle ("pull request #12 merged"). */
          reason: settleReasonSchema,
          /** The package or trigger asking, e.g. "@dshfiles/pull-requests". */
          source: settleSourceSchema,
        }),
      ),
      output: settleRequestResultSchema,
      description:
        'Ask the thread sidebar to settle threads for an automatic trigger. Running, waiting, blank, archived, pinned and opted-out threads (and ones with a running subagent) are skipped and reported, never settled.',
    }),
  },
})
