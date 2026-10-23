import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { THREAD_STATUS_FILTER_GROUPS, ThreadViewModel, type ThreadViewAttentionEntry } from './thread-view.js'

describe('thread view grouping', () => {
  it('offers Inactive in the attention filter group', () => {
    expect(THREAD_STATUS_FILTER_GROUPS.find(group => group.id === 'attention')?.filters).toContain('inactive')
  })

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

  it('uses recent finished activity when a thread summary still has its old creation date', () => {
    const now = new Date(2026, 9, 23, 0, 18).getTime()
    const oldThreadDate = new Date(2026, 9, 20, 15, 25).getTime()
    const recentFinish = new Date(2026, 9, 23, 0, 12).getTime()
    const activityAt = ThreadViewModel.latestActivityAt(oldThreadDate, recentFinish)
    const groups = ThreadViewModel.groupEntries({
      groupBy: 'date',
      entries: [{ thread: { id: 'backlog-started', updatedAt: oldThreadDate }, workspaceId: undefined, activityAt }],
      workspaceTitles: new Map(),
      unassignedTitle: 'Unassigned',
      dateTitles: { today: 'Today', yesterday: 'Yesterday', lastSevenDays: 'Last 7 days', older: 'Older' },
      now,
    })

    expect(groups).toMatchObject([{ label: 'Today', threads: [{ id: 'backlog-started' }] }])
  })

  it('puts local and remote rows in the same current project group', () => {
    const groups = ThreadViewModel.groupEntries({
      groupBy: 'project',
      entries: [
        { thread: { id: 'local-thread', updatedAt: 10 }, workspaceId: 'project:shared' },
        { thread: { id: 'remote-thread', updatedAt: 20 }, workspaceId: 'project:shared' },
      ],
      workspaceTitles: new Map([['project:shared', 'Shared project']]),
      unassignedTitle: 'Unassigned',
      dateTitles: { today: 'Today', yesterday: 'Yesterday', lastSevenDays: 'Last 7 days', older: 'Older' },
      now: 100,
    })

    expect(groups).toMatchObject([{ label: 'Shared project', threads: [{ id: 'remote-thread' }, { id: 'local-thread' }] }])
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

  it('badges a view from the rows that carry its own attention label', () => {
    const runningFinishedChild = {
      thread: {},
      attentionLabel: 'threadSidebarTurnFinished',
      running: true,
      archived: false,
      settled: false,
      muted: false,
    } as const

    expect(ThreadViewModel.attentionLabelForView({ filters: ['turn-finished'], sourceFilter: 'all', entries: [runningFinishedChild] })).toBe(
      'threadSidebarTurnFinished',
    )
    expect(ThreadViewModel.attentionLabelForView({ filters: ['input-needed'], sourceFilter: 'all', entries: [runningFinishedChild] })).toBeUndefined()
  })

  it('does not badge an inactive view with unrelated attention colors', () => {
    const interrupted = {
      thread: {},
      attentionLabel: 'threadSidebarInterrupted',
      running: false,
      inactive: true,
      archived: false,
      settled: false,
      muted: false,
    } as const

    expect(ThreadViewModel.attentionLabelForView({ filters: ['inactive'], sourceFilter: 'all', entries: [interrupted] })).toBeUndefined()
    expect(ThreadViewModel.attentionLabelForView({ filters: ['inactive', 'interrupted'], sourceFilter: 'all', entries: [interrupted] })).toBe(
      'threadSidebarInterrupted',
    )
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

    expect(ThreadViewModel.attentionLabelForView({ filters: ['turn-finished'], sourceFilter: 'subagents', entries })).toBeUndefined()
    expect(ThreadViewModel.attentionLabelForView({ filters: ['input-needed'], sourceFilter: 'main', entries })).toBeUndefined()
    expect(ThreadViewModel.attentionLabelForView({ filters: ['input-needed'], sourceFilter: 'subagents', entries })).toBe('threadSidebarInputNeeded')
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
    expect(ThreadViewModel.unreadCountForView({ filters: ['unread'], sourceFilter: 'all', entries })).toBe(2)
    expect(ThreadViewModel.unreadCountForView({ filters: ['settled'], sourceFilter: 'all', entries })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: ['archived'], sourceFilter: 'all', entries })).toBe(1)
  })

  it('counts an unread row by the filter it matches, not by the unread flag alone', () => {
    const manuallyUnread = entry({ unread: true })
    const unreadAttention = entry({ attentionLabel: 'threadSidebarInputNeeded', unread: true, running: true })

    expect(ThreadViewModel.unreadCountForView({ filters: ['turn-finished'], sourceFilter: 'all', entries: [manuallyUnread] })).toBe(0)
    expect(ThreadViewModel.unreadCountForView({ filters: ['attention'], sourceFilter: 'all', entries: [manuallyUnread] })).toBe(0)
    expect(ThreadViewModel.unreadCountForView({ filters: ['input-needed'], sourceFilter: 'all', entries: [unreadAttention] })).toBe(1)
  })

  it('follows the view source filter and leaves muted threads out unless the view asks for them', () => {
    const entries = [entry({ unread: true }), entry({ unread: true, thread: { origin: 'subagent' } }), entry({ unread: true, muted: true })]

    expect(ThreadViewModel.unreadCountForView({ filters: [], sourceFilter: 'main', entries })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: [], sourceFilter: 'subagents', entries })).toBe(1)
    expect(ThreadViewModel.unreadCountForView({ filters: ['muted'], sourceFilter: 'all', entries })).toBe(1)
  })
})

describe('thread view filters', () => {
  type FilterState = Parameters<typeof ThreadViewModel.matchesStatusFilter>[0]
  const filterState = (overrides: Partial<FilterState> = {}): FilterState => ({
    filters: [],
    running: false,
    labels: [],
    unread: false,
    archived: false,
    settled: false,
    muted: false,
    ...overrides,
  })

  it('hides /btw side chats by their title marker only', () => {
    expect(ThreadViewModel.isSideChat({ title: 'btw · why is the build slow?' })).toBe(true)
    expect(ThreadViewModel.isSideChat({ title: 'btw: notes' })).toBe(false)
    expect(ThreadViewModel.isSideChat({})).toBe(false)
  })

  it('admits recent, pinned and parked idle rows without changing inactive semantics', () => {
    for (const row of [
      { title: 'Linearize jj history from main origin', inactive: false },
      { title: 'Pinned idle', inactive: false, pinned: true },
      { title: 'Parked idle', inactive: false, parked: true },
      { title: 'Old idle', inactive: true },
    ]) {
      expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['not-running'], inactive: row.inactive })), row.title).toBe(true)
      expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['inactive'], inactive: row.inactive })), row.title).toBe(row.inactive)
    }
    expect(THREAD_STATUS_FILTER_GROUPS[0].filters).toContain('not-running')
  })

  it('excludes effectively running own turns and parents, but preserves attention OR matching', () => {
    for (const kind of ['own turn', 'parent with running descendant']) {
      expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['not-running'], running: true })), kind).toBe(false)
      expect(
        ThreadViewModel.matchesStatusFilter(filterState({ filters: ['not-running', 'attention'], running: true, labels: ['threadSidebarInputNeeded'] })),
        kind,
      ).toBe(true)
    }
  })

  it('requires explicit selectors to admit stored idle rows', () => {
    for (const storage of ['muted', 'settled', 'archived'] as const) {
      expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['not-running'], [storage]: true }))).toBe(false)
      expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['not-running', storage], [storage]: true }))).toBe(true)
    }
  })

  it('counts and badges exactly matching not-running rows', () => {
    const idle = {
      thread: {},
      attentionLabel: 'threadSidebarTurnFinished',
      unread: true,
      running: false,
      archived: false,
      settled: false,
      muted: false,
    } as const
    const entries = [
      idle,
      { ...idle, running: true },
      { ...idle, archived: true },
      { ...idle, settled: true },
      { ...idle, muted: true },
      { ...idle, thread: { origin: 'subagent' } },
    ] as const
    expect(ThreadViewModel.unreadCountForView({ filters: ['not-running'], sourceFilter: 'main', entries })).toBe(1)
    expect(ThreadViewModel.attentionLabelForView({ filters: ['not-running'], sourceFilter: 'main', entries: [idle] })).toBe('threadSidebarTurnFinished')
    expect(ThreadViewModel.attentionLabelForView({ filters: ['not-running'], sourceFilter: 'main', entries: entries.slice(1) })).toBeUndefined()
  })

  it('filters supported activity states', () => {
    expect(ThreadViewModel.matchesStatusFilter(filterState())).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['working'], running: true }))).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['inactive'], inactive: true }))).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['inactive'], inactive: false }))).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['working'] }))).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['attention'], labels: ['threadSidebarInputNeeded'] }))).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['attention'] }))).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['archived'], archived: true }))).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['settled'], settled: true }))).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['settled'] }))).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['muted'], muted: true, running: true }))).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['muted'], running: true }))).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['working', 'attention'], labels: ['threadSidebarInterrupted'] }))).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter(filterState({ filters: ['working', 'attention'] }))).toBe(false)
  })

  it('matches the attention labels a row carries, alone or combined', () => {
    const finished = filterState({ labels: ['threadSidebarTurnFinished'], unread: true })
    const inputNeededWithFinishedChild = filterState({ labels: ['threadSidebarInputNeeded', 'threadSidebarTurnFinished'] })

    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['turn-finished'] })).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['input-needed'] })).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['needs-resume'] })).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['attention'] })).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['turn-finished', 'needs-resume'] })).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter({ ...inputNeededWithFinishedChild, filters: ['turn-finished'] })).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter({ ...inputNeededWithFinishedChild, filters: ['input-needed'] })).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['unread'] })).toBe(true)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['unread'], archived: true })).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['unread'], settled: true })).toBe(false)
    expect(ThreadViewModel.matchesStatusFilter({ ...finished, filters: ['unread'], unread: false })).toBe(false)
  })

  it('keeps recovery children of main threads visible in main-source views', () => {
    const interruptedChild = { origin: 'subagent', parentId: SessionId('main-root') } as const

    expect(ThreadViewModel.matchesAttentionSourceFilter({ thread: interruptedChild, rootThread: {}, sourceFilter: 'main' })).toBe(true)
    expect(ThreadViewModel.matchesAttentionSourceFilter({ thread: interruptedChild, rootThread: { origin: 'subagent' }, sourceFilter: 'main' })).toBe(false)
    expect(ThreadViewModel.matchesAttentionSourceFilter({ thread: interruptedChild, rootThread: undefined, sourceFilter: 'main' })).toBe(false)
  })

  it('filters main and subagent sources using Host lineage metadata', () => {
    expect(ThreadViewModel.matchesSourceFilter({}, 'main')).toBe(true)
    expect(ThreadViewModel.matchesSourceFilter({ origin: 'subagent' }, 'main')).toBe(false)
    expect(ThreadViewModel.matchesSourceFilter({ parentId: SessionId('parent') }, 'subagents')).toBe(true)
    expect(ThreadViewModel.matchesSourceFilter({ origin: 'subagent' }, 'subagents')).toBe(true)
    expect(ThreadViewModel.matchesSourceFilter({}, 'all')).toBe(true)
  })
})
