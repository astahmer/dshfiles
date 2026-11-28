import { describe, expect, it } from 'vitest'
import { FinishedTurnAttention } from './inbox-provider.js'
import { EMPTY_PENDING_APPROVALS, PendingApprovalsModel, type PendingApprovalsState } from './pending-approvals.js'
import type { SessionEvent } from './session-events.js'

/** The event fields this fold reads, across tool/call, approval/asked, approval/decided and turn/end. */
interface FoldedEventData {
  readonly turn?: number
  readonly step?: number
  readonly callId?: string
  readonly name?: string
  readonly arguments?: string
  readonly id?: string
  readonly toolName?: string
  readonly reason?: string
  readonly outcome?: string
}

const at = (sessionId: string, type: string, data: FoldedEventData, seq = 1): SessionEvent => ({
  sessionId,
  origin: undefined,
  parentSessionId: undefined,
  // SAFETY: the fold reads `type`, `time` and the decoded `data` of each event; this builds that exact shape.
  event: { type, seq, time: 1_000 + seq, data } as SessionEvent['event'],
})

const fold = (events: readonly SessionEvent[]): PendingApprovalsState => events.reduce(PendingApprovalsModel.apply, EMPTY_PENDING_APPROVALS)

const args = JSON.stringify({ command: 'git push --force origin main', description: 'Clear the cache and force-push main' })
const asked = [
  at('thread-a', 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: args }, 1),
  at('thread-a', 'approval/asked', { id: 'ask-1', toolName: 'bash', callId: 'call-1', reason: 'escalate to danger-full-access' }, 2),
]

describe('pending approvals in the inbox', () => {
  it('publishes one blocking Review item per pending approval, naming the command', () => {
    const drafts = FinishedTurnAttention.approvalDraftsOf(PendingApprovalsModel.listOf(fold(asked)))
    expect(drafts).toEqual([
      {
        dedupeKey: 'thread-a:approval:ask-1',
        subject: { kind: 'session', id: 'thread-a' },
        reason: 'Approve: Clear the cache and force-push main',
        detail: 'git push --force origin main',
        severity: 'blocking',
        verbs: ['Open', 'Snooze', 'MuteSource'],
      },
    ])
  })

  it('resolves when the approval is decided or its turn ends', () => {
    expect(PendingApprovalsModel.listOf(fold([...asked, at('thread-a', 'approval/decided', { id: 'ask-1', outcome: 'allowed-once' }, 3)]))).toEqual([])
    expect(PendingApprovalsModel.listOf(fold([...asked, at('thread-a', 'turn/end', { reason: 'completed' }, 3)]))).toEqual([])
    expect(PendingApprovalsModel.listOf(fold([...asked, at('thread-b', 'turn/end', { reason: 'completed' }, 3)]))).toHaveLength(1)
  })
})

describe('a failed turn in the inbox', () => {
  const failed = [{ sessionId: 'thread-f', failedAt: 5_000, reason: 'error' as const }]

  it('stays an item after the thread is opened, keyed by its failure, until retried or Done', () => {
    // Opening the thread clears its unread record: no view is left, the failure still publishes.
    const drafts = FinishedTurnAttention.failedDraftsOf(failed, new Map(), new Map([['thread-f', 'Ship the hotfix']]))
    expect(drafts).toEqual([
      {
        dedupeKey: 'thread-f:failed:5000',
        subject: { kind: 'session', id: 'thread-f' },
        reason: '“Ship the hotfix” failed',
        severity: 'failed',
        verbs: ['Open', 'Done', 'Snooze', 'MuteSource'],
      },
    ])
    expect(FinishedTurnAttention.failedSessionOfItem({ source: 'thread-sidebar.finished-turn', dedupeKey: 'thread-f:failed:5000', subject: { kind: 'session', id: 'thread-f' } })).toBe(
      'thread-f',
    )
    expect(FinishedTurnAttention.failedDraftsOf(failed, new Map([['thread-f', 'parent']]))).toEqual([])
  })

  it('is published once: the unread view of the same failure yields to the durable item', () => {
    const view = {
      sessionId: 'thread-f',
      version: 1,
      finishedAt: 5_000,
      finishedSeq: 9,
      finishedReason: 'error' as const,
      manuallyUnread: false,
    }
    // SAFETY: draftsOf reads the fields above; the view's other fields are irrelevant to this rule.
    const views = [view] as unknown as Parameters<typeof FinishedTurnAttention.draftsOf>[0]
    expect(FinishedTurnAttention.draftsOf(views, new Map(), new Map(), new Set(['thread-f']))).toEqual([])
    expect(FinishedTurnAttention.draftsOf(views)).toHaveLength(1)
    // Marked unread after it was opened: still one item, the kept failure.
    // SAFETY: as above, draftsOf reads only these fields.
    const unread = [{ ...view, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true }] as unknown as Parameters<typeof FinishedTurnAttention.draftsOf>[0]
    expect(FinishedTurnAttention.draftsOf(unread, new Map(), new Map(), new Set(['thread-f']))).toEqual([])
  })
})
