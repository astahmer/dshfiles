import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(256)

const settleReasonSchema = z.string().min(1).max(200)

const settleSourceSchema = z.string().min(1).max(120)

const settleEntrySchema = z
  .object({
    sessionId: sessionIdSchema,
    reason: settleReasonSchema,
    source: settleSourceSchema,
    at: z.number(),
  })
  .strict()

const scanSchema = z
  .object({
    at: z.number(),
    durationMs: z.number(),
    idleSettled: z.number().int().nonnegative(),
    rebasedSettled: z.number().int().nonnegative(),
    error: z.string().max(500).optional(),
  })
  .strict()

const skipSchema = z.enum(['unknown', 'running', 'running-descendant', 'pending-question', 'blank', 'archived', 'pinned', 'opted-out'])

export const autoSettleStatusSchema = z
  .object({
    /** The Host scans on its own; a browser with this answer runs no scan of its own. */
    hostScan: z.literal(true),
    /** Whether idle or rebased auto-settle is switched on in the sidebar settings. */
    active: z.boolean(),
    intervalMinutes: z.number().int().positive(),
    nextScanAt: z.number().nullable(),
    lastScan: scanSchema.nullable(),
    /** The newest automatic settles, newest first, with the trigger that asked for each. */
    recent: z.array(settleEntrySchema).max(50),
  })
  .strict()

export type AutoSettleStatus = z.infer<typeof autoSettleStatusSchema>

export const settleRequestResultSchema = z
  .object({
    results: z.array(
      z
        .object({
          sessionId: sessionIdSchema,
          outcome: z.enum(['settled', 'already-settled', 'skipped']),
          skipReason: skipSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict()

export type SettleRequestResult = z.infer<typeof settleRequestResultSchema>

const renderStatus = (status: AutoSettleStatus): string => {
  const lines = [
    status.active ? `Auto-settle is on; the Host checks every ${String(status.intervalMinutes)} min.` : 'Auto-settle is off in the thread-sidebar settings.',
  ]
  if (status.lastScan !== null) {
    const scan = status.lastScan
    lines.push(
      scan.error === undefined
        ? `Last scan ${new Date(scan.at).toISOString()}: ${String(scan.idleSettled)} idle and ${String(scan.rebasedSettled)} rebased threads settled.`
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
      input: z.object({}).strict(),
      output: autoSettleStatusSchema,
      description:
        'Read the Host auto-settle state: whether idle or rebased auto-settle is on, the scan interval, the last and next scan, and the newest automatic settles with the trigger and reason behind each. Read-only.',
      tool: { name: 'thread_auto_settle_status', readOnly: true, render: renderStatus },
    }),
    requestSettle: method({
      input: z
        .object({
          sessionIds: z.array(sessionIdSchema).min(1).max(100),
          /** Why the thread should settle, shown with the automatic settle ("pull request #12 merged"). */
          reason: settleReasonSchema,
          /** The package or trigger asking, e.g. "@dshfiles/pull-requests". */
          source: settleSourceSchema,
        })
        .strict(),
      output: settleRequestResultSchema,
      description:
        'Ask the thread sidebar to settle threads for an automatic trigger. Running, waiting, blank, archived, pinned and opted-out threads (and ones with a running subagent) are skipped and reported, never settled.',
    }),
  },
})
