import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { ApprovalRows } from './approval-rows.js'
import { ApprovalDetail } from './approval-detail.js'
import { ThreadStatusModel } from './thread-status.js'
import { WorkingThreadsProjection } from './working-threads.js'

const NOW = 10_000_000_000

describe('a thread waiting on an approval', () => {
  const selected = { id: SessionId('selected'), blank: false, running: true, updatedAt: 10 }

  it('is Needs you on the open thread too, and no Working count includes it', () => {
    const rows = ApprovalRows.select({
      sessions: [selected],
      pendingInteractionKindFor: () => 'approval',
      mutedSessionIds: new Set<string>(),
      archivedSessionIds: new Set<string>(),
      settledSessionIds: new Set<string>(),
      matchesWorkspace: () => true,
    })
    expect(rows.map(row => row.id)).toEqual([selected.id])

    const status = ThreadStatusModel.statusOf({
      running: true,
      pinned: false,
      archived: false,
      settled: false,
      unread: false,
      labels: rows.length > 0 ? ['threadSidebarApprovalNeeded'] : [],
      inbox: undefined,
      waitingDetail: ApprovalDetail.of({ kind: 'approval', step: 'Running git push --force origin main && rm -rf build' }),
      activityAt: NOW - 1_000,
      settledAt: undefined,
      now: NOW,
    })
    expect(status.group).toBe('needs-you')
    // The row says the command; its glyph and Review verb say it waits for an approval (round five B4).
    expect(status.detail).toBe('git push --force origin…')

    const working = WorkingThreadsProjection.ids([{ session: { id: selected.id, running: true }, activity: { running: true } }], {
      statusOf: () => status.status,
      waiting: new Set(),
    })
    expect(working.size).toBe(0)
  })

  it('names the command, else the reason the tool gave, else nothing', () => {
    expect(ApprovalDetail.of({ kind: 'approval', step: 'Running pnpm test' })).toBe('Approve: pnpm test')
    expect(ApprovalDetail.of({ kind: 'approval', step: 'Running a command', reason: 'Push the release tag' })).toBe('Approve: Push the release tag')
    expect(ApprovalDetail.of({ kind: 'approval', step: null })).toBeUndefined()
    expect(ApprovalDetail.of({ kind: 'plan-review', step: 'Running pnpm test' })).toBeUndefined()
  })
})
