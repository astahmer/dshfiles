import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { ThreadViewModel, type ThreadViewAttentionEntry } from './thread-view.js'

describe('thread view grouping', () => {
  it('groups repositories alphabetically and keeps newest threads first', () => {
    const groups = ThreadViewModel.groupEntries({
      groupBy: 'project',
      entries: [
        { thread: { id: 'older', updatedAt: 10 }, workspaceId: 'zeta' },
        { thread: { id: 'newest', updatedAt: 30 }, workspaceId: 'alpha' },
        { thread: { id: 'newer', updatedAt: 20 }, workspaceId: 'zeta' },
      ],
      workspaceTitles: new Map([
        ['alpha', 'Alpha'],
        ['zeta', 'Zeta'],
      ]),
      unassignedTitle: 'Unassigned',
      dateTitles: { today: 'Today', yesterday: 'Yesterday', lastSevenDays: 'Last 7 days', older: 'Older' },
      now: 100,
    })

    expect(groups.map(group => [group.label, group.threads.map(thread => thread.id)])).toEqual([
      ['Alpha', ['newest']],
      ['Zeta', ['newer', 'older']],
    ])
  })

  it('groups activity by local calendar date and leaves none as one flat list', () => {
    const now = new Date(2025, 3, 10, 12).getTime()
    expect(ThreadViewModel.dateGroup(new Date(2025, 3, 10, 1).getTime(), now)).toBe('today')
    expect(ThreadViewModel.dateGroup(new Date(2025, 3, 9, 23).getTime(), now)).toBe('yesterday')
    expect(ThreadViewModel.dateGroup(new Date(2025, 3, 4, 12).getTime(), now)).toBe('lastSevenDays')
    expect(ThreadViewModel.dateGroup(new Date(2025, 3, 3, 12).getTime(), now)).toBe('older')
    expect(
      ThreadViewModel.groupEntries({
        groupBy: 'date',
        entries: [
          { thread: { id: 'older', updatedAt: new Date(2025, 3, 3, 12).getTime() }, workspaceId: undefined },
          { thread: { id: 'today', updatedAt: new Date(2025, 3, 10, 8).getTime() }, workspaceId: undefined },
          { thread: { id: 'yesterday', updatedAt: new Date(2025, 3, 9, 8).getTime() }, workspaceId: undefined },
          { thread: { id: 'last-seven-days', updatedAt: new Date(2025, 3, 4, 8).getTime() }, workspaceId: undefined },
        ],
        workspaceTitles: new Map(),
        unassignedTitle: 'Unassigned',
        dateTitles: { today: 'Today', yesterday: 'Yesterday', lastSevenDays: 'Last 7 days', older: 'Older' },
        now,
      }),
    ).toMatchObject([
      { label: 'Today', threads: [{ id: 'today' }] },
      { label: 'Yesterday', threads: [{ id: 'yesterday' }] },
      { label: 'Last 7 days', threads: [{ id: 'last-seven-days' }] },
      { label: 'Older', threads: [{ id: 'older' }] },
    ])
    expect(
      ThreadViewModel.groupEntries({
        groupBy: 'none',
        entries: [
          { thread: { id: 'older', updatedAt: 10 }, workspaceId: 'one' },
          { thread: { id: 'newer', updatedAt: 20 }, workspaceId: 'two' },
        ],
        workspaceTitles: new Map(),
        unassignedTitle: 'Unassigned',
        dateTitles: { today: 'Today', yesterday: 'Yesterday', lastSevenDays: 'Last 7 days', older: 'Older' },
        now,
      }),
    ).toMatchObject([{ label: '', showHeader: false, threads: [{ id: 'newer' }, { id: 'older' }] }])
  })
})

describe('thread view attention markers', () => {
  it('selects one highest-priority attention state among matching threads', () => {
    expect(
      ThreadViewModel.attentionLabelForView({
        filters: ['working'],
        sourceFilter: 'all',
        entries: [
          {
            thread: {},
            attentionLabel: 'threadSidebarInputNeeded',
            running: true,
            archived: false,
            settled: false,
            muted: false,
          },
          {
            thread: {},
            attentionLabel: 'threadSidebarInterrupted',
            running: true,
            archived: false,
            settled: false,
            muted: false,
          },
          {
            thread: {},
            attentionLabel: 'threadSidebarTurnFinished',
            running: false,
            archived: false,
            settled: false,
            muted: false,
          },
        ],
      }),
    ).toBe('threadSidebarInterrupted')
  })

  it('only considers attention threads that match the tab source and status', () => {
    const entries = [
      {
        thread: { origin: 'subagent' },
        attentionLabel: 'threadSidebarInputNeeded',
        running: false,
        archived: false,
        settled: false,
        muted: false,
      },
    ] as const

    expect(ThreadViewModel.attentionLabelForView({ filters: ['working'], sourceFilter: 'subagents', entries })).toBeUndefined()
    expect(ThreadViewModel.attentionLabelForView({ filters: ['not-working'], sourceFilter: 'main', entries })).toBeUndefined()
    expect(ThreadViewModel.attentionLabelForView({ filters: ['not-working'], sourceFilter: 'subagents', entries })).toBe('threadSidebarInputNeeded')
  })
})

describe('thread view unread counts', () => {
  const entry = (overrides: Partial<ThreadViewAttentionEntry> = {}): ThreadViewAttentionEntry => ({
    thread: {},
    attentionLabel: undefined,
    unread: false,
    running: false,
    archived: false,
    settled: false,
    muted: false,
    ...overrides,
  })

  it('counts only unread threads the view lists', () => {
    const entries = [
      entry({ unread: true }),
      entry({ unread: false }),
      entry({ unread: true, archived: true }),
      entry({ unread: true, settled: true }),
      entry({ unread: true, running: true }),
    ]

    expect(ThreadViewModel.unreadCountForView({ filters: [], sourceFilter: 'all', entries })).toBe(4)
    expect(ThreadViewModel.unreadCountForView({ filters: ['not-working'], sourceFilter: 'all', entries })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: ['settled'], sourceFilter: 'all', entries })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: ['archived'], sourceFilter: 'all', entries })).toBe(1)
  })

  it('does not count an unread running thread that the view would hide', () => {
    const manuallyUnread = entry({ unread: true, running: true })

    expect(ThreadViewModel.unreadCountForView({ filters: ['not-working'], sourceFilter: 'all', entries: [manuallyUnread] })).toBe(0)
    expect(ThreadViewModel.unreadCountForView({ filters: ['attention'], sourceFilter: 'all', entries: [manuallyUnread] })).toBe(0)
  })

  it('counts an unread running thread when its attention makes it visible', () => {
    const unreadAttention = entry({ attentionLabel: 'threadSidebarInputNeeded', unread: true, running: true })

    expect(ThreadViewModel.unreadCountForView({ filters: ['not-working'], sourceFilter: 'all', entries: [unreadAttention] })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: ['attention'], sourceFilter: 'all', entries: [unreadAttention] })).toBe(1)
  })

  it('follows the view source filter and leaves muted threads out unless the view asks for them', () => {
    const entries = [entry({ unread: true }), entry({ unread: true, thread: { origin: 'subagent' } }), entry({ unread: true, muted: true })]

    expect(ThreadViewModel.unreadCountForView({ filters: [], sourceFilter: 'main', entries })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: [], sourceFilter: 'subagents', entries })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: ['muted'], sourceFilter: 'all', entries })).toBe(1)
  })
})

describe('thread view filters', () => {
  it('hides /btw side chats by their title marker only', () => {
    expect(ThreadViewModel.isSideChat({ title: 'btw · why is the build slow?' })).toBe(true)
    expect(ThreadViewModel.isSideChat({ title: 'btw: notes' })).toBe(false)
    expect(ThreadViewModel.isSideChat({})).toBe(false)
  })

  it('filters supported activity states', () => {
    expect(ThreadViewModel.matchesStatusFilter({ filters: [], running: false, needsAttention: false, archived: false, settled: false, muted: false })).toBe(
      true,
    )
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['working'], running: true, needsAttention: false, archived: false, settled: false, muted: false }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['working'], running: false, needsAttention: false, archived: false, settled: false, muted: false }),
    ).toBe(false)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['attention'], running: false, needsAttention: true, archived: false, settled: false, muted: false }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['archived'], running: false, needsAttention: false, archived: true, settled: false, muted: false }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['settled'], running: false, needsAttention: false, archived: false, settled: true, muted: false }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['settled'], running: false, needsAttention: false, archived: false, settled: false, muted: false }),
    ).toBe(false)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['muted'], running: true, needsAttention: false, archived: false, settled: false, muted: true }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['muted'], running: true, needsAttention: false, archived: false, settled: false, muted: false }),
    ).toBe(false)
    expect(
      ThreadViewModel.matchesStatusFilter({
        filters: ['working', 'attention'],
        running: false,
        needsAttention: true,
        archived: false,
        settled: false,
        muted: false,
      }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({
        filters: ['working', 'attention'],
        running: false,
        needsAttention: false,
        archived: false,
        settled: false,
        muted: false,
      }),
    ).toBe(false)
  })

  it('includes stopped input-needed and usage-limit threads in Not working', () => {
    for (const status of ['input-needed', 'usage-limit']) {
      expect(
        ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: false, needsAttention: true, archived: false, settled: false, muted: false }),
        status,
      ).toBe(true)
    }
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: false, needsAttention: false, archived: false, settled: false, muted: false }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: true, needsAttention: true, archived: false, settled: false, muted: false }),
    ).toBe(true)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: true, needsAttention: false, archived: false, settled: false, muted: false }),
    ).toBe(false)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: false, needsAttention: false, archived: true, settled: false, muted: false }),
    ).toBe(false)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: false, needsAttention: false, archived: false, settled: false, muted: true }),
    ).toBe(false)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: false, needsAttention: true, archived: false, settled: true, muted: false }),
    ).toBe(false)
    expect(
      ThreadViewModel.matchesStatusFilter({ filters: ['not-working'], running: false, needsAttention: false, archived: false, settled: true, muted: false }),
    ).toBe(false)
  })

  it('filters main and subagent sources using Host lineage metadata', () => {
    expect(ThreadViewModel.matchesSourceFilter({}, 'main')).toBe(true)
    expect(ThreadViewModel.matchesSourceFilter({ origin: 'subagent' }, 'main')).toBe(false)
    expect(ThreadViewModel.matchesSourceFilter({ parentId: SessionId('parent') }, 'subagents')).toBe(true)
    expect(ThreadViewModel.matchesSourceFilter({ origin: 'subagent' }, 'subagents')).toBe(true)
    expect(ThreadViewModel.matchesSourceFilter({}, 'all')).toBe(true)
  })
})
