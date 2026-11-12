import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { ThreadAttentionView } from './attention-api.js'
import { FinishedTurnAttention } from './inbox-provider.js'
import { SessionLineage, type LineageHeader } from './session-lineage.js'

const finished = (sessionId: string, finishedAt: number, finishedReason: ThreadAttentionView['finishedReason'] = 'completed'): ThreadAttentionView => ({
  sessionId,
  version: finishedAt,
  finishedAt,
  finishedSeq: finishedAt,
  finishedReason,
  manuallyUnread: false,
})

describe('thread-sidebar inbox provider', () => {
  it('states each unacknowledged turn as its own ready or failed occurrence and a hand-made unread mark as one item', () => {
    const drafts = FinishedTurnAttention.draftsOf([
      { sessionId: 'session-a', version: 2, finishedAt: 10, finishedSeq: 7, finishedReason: 'completed', manuallyUnread: false },
      { sessionId: 'session-b', version: 3, finishedAt: 11, finishedSeq: 4, finishedReason: 'error', manuallyUnread: false },
      { sessionId: 'session-c', version: 4, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true },
      { sessionId: 'session-d', version: 5, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: false },
    ])
    expect(drafts.map(draft => [draft.dedupeKey, draft.severity])).toEqual([
      ['session-a:turn:7', 'ready'],
      ['session-b:turn:4', 'failed'],
      ['session-c:unread', 'ready'],
    ])
    expect(drafts.every(draft => draft.subject.kind === 'session' && draft.verbs.includes('Open'))).toBe(true)
  })

  it('leads the headline with the thread title, and keeps the plain sentence without one', () => {
    const titles = new Map([
      ['session-a', 'Fix auth callback'],
      ['session-b', 'Flaky test'],
      ['session-c', 'x'.repeat(300)],
    ])
    const drafts = FinishedTurnAttention.draftsOf(
      [finished('session-a', 10), finished('session-b', 11, 'error'), finished('session-c', 12), finished('session-d', 13)],
      new Map(),
      titles,
    )
    expect(drafts.map(draft => draft.reason)).toEqual([
      '“Fix auth callback” finished · ready to review',
      '“Flaky test” failed',
      `“${'x'.repeat(159)}…” finished · ready to review`,
      'Turn finished; ready to review.',
    ])
  })

  it('matches Done in the inbox to the thread record only while the item is its current turn', () => {
    const views = [{ sessionId: 'session-a', version: 2, finishedAt: 10, finishedSeq: 7, finishedReason: 'completed' as const, manuallyUnread: false }]
    const item = (dedupeKey: string, source = 'thread-sidebar.finished-turn') => ({ source, dedupeKey, subject: { kind: 'session' as const, id: 'session-a' } })
    expect(FinishedTurnAttention.viewForDoneItem(item('session-a:turn:7'), views)?.version).toBe(2)
    // An older turn's item, or another provider's item about the same thread, leaves the dot alone.
    expect(FinishedTurnAttention.viewForDoneItem(item('session-a:turn:3'), views)).toBeUndefined()
    expect(FinishedTurnAttention.viewForDoneItem(item('session-a:turn:7', 'agent-questions.child-question'), views)).toBeUndefined()
  })

  it('publishes no item for a subagent and rolls its finished turns into the parent item as a count (E1)', () => {
    const views = [
      finished('parent', 100),
      finished('child-a', 40),
      finished('child-b', 60, 'error'),
      // Finished after the parent's turn: it waits for the parent's next turn instead of reopening this one.
      finished('child-late', 120),
      finished('grandchild', 50),
      finished('orphan-child', 30),
    ]
    const roots = new Map([
      ['parent', 'parent'],
      ['child-a', 'parent'],
      ['child-b', 'parent'],
      ['child-late', 'parent'],
      ['grandchild', 'parent'],
      ['orphan-child', 'parent-read'],
    ])
    const drafts = FinishedTurnAttention.draftsOf(views, roots)
    expect(drafts.map(draft => draft.subject.id)).toEqual(['parent'])
    expect(drafts[0]?.detail).toBe('3 subagent turns finished; 1 failed.')
    // One child is singular; a parent whose children have not finished carries no line.
    expect(FinishedTurnAttention.draftsOf([finished('parent', 100), finished('child-a', 40)], roots)[0]?.detail).toBe('1 subagent turn finished.')
    expect(FinishedTurnAttention.draftsOf([finished('parent', 100)], roots)[0]).not.toHaveProperty('detail')
  })

  it('drops the child items published before the roll-up, so reconcile resolves them once', () => {
    const views = [finished('parent', 100), finished('child-a', 40)]
    const before = FinishedTurnAttention.draftsOf(views)
    const after = FinishedTurnAttention.draftsOf(views, new Map([['child-a', 'parent']]))
    const listed = new Set(after.map(draft => draft.dedupeKey))
    // Inbox reconcile resolves every open item of the source it is not given: the child item, and nothing else.
    expect(before.filter(draft => !listed.has(draft.dedupeKey)).map(draft => draft.subject.id)).toEqual(['child-a'])
    expect(FinishedTurnAttention.draftsOf(views, new Map([['child-a', 'parent']]))).toEqual(after)
  })

  it('clears subagent records once their parent thread is read, and keeps those of a parent still running', () => {
    const roots = new Map([
      ['child-a', 'parent'],
      ['child-b', 'running-parent'],
    ])
    const children = [finished('child-a', 40), finished('child-b', 50)]
    // First reconcile: records stored before the roll-up whose parent holds no record are stale.
    expect(FinishedTurnAttention.staleChildren(children, roots, 'all').map(entry => entry.sessionId)).toEqual(['child-a', 'child-b'])
    // Later: only a parent that had a record and lost it (the user opened it) clears its children.
    expect(FinishedTurnAttention.staleChildren(children, roots, new Set(['parent'])).map(entry => entry.sessionId)).toEqual(['child-a'])
    expect(FinishedTurnAttention.staleChildren([...children, finished('parent', 100)], roots, new Set(['parent']))).toEqual([])
    expect(FinishedTurnAttention.staleChildren(children, roots, new Set())).toEqual([])
  })

  it('walks a subagent to its top-level thread and stops at the last header it can read', () => {
    const headers = new Map<string, LineageHeader>([
      ['root', { subagent: false, parentSessionId: undefined }],
      ['fork', { subagent: false, parentSessionId: 'root' }],
      ['child', { subagent: true, parentSessionId: 'root' }],
      ['grandchild', { subagent: true, parentSessionId: 'child' }],
      ['lost', { subagent: true, parentSessionId: 'pruned' }],
    ])
    const rootOf = (sessionId: string) =>
      Effect.runSync(SessionLineage.use(lineage => lineage.rootOf(sessionId)).pipe(Effect.provide(SessionLineage.layerTest(headers))))
    expect(['root', 'fork', 'child', 'grandchild', 'lost', 'unknown'].map(rootOf)).toEqual(['root', 'fork', 'root', 'root', 'lost', 'unknown'])
  })
})
