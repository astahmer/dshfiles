import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { groupThreadEntries, isSideChat, matchesThreadSourceFilter, matchesThreadStatusFilter, threadDateGroup } from './thread-view.js'

describe('thread view grouping', () => {
  it('groups repositories alphabetically and keeps newest threads first', () => {
    const groups = groupThreadEntries({
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
    expect(threadDateGroup(new Date(2025, 3, 10, 1).getTime(), now)).toBe('today')
    expect(threadDateGroup(new Date(2025, 3, 9, 23).getTime(), now)).toBe('yesterday')
    expect(threadDateGroup(new Date(2025, 3, 4, 12).getTime(), now)).toBe('lastSevenDays')
    expect(threadDateGroup(new Date(2025, 3, 3, 12).getTime(), now)).toBe('older')
    expect(
      groupThreadEntries({
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
      groupThreadEntries({
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

describe('thread view filters', () => {
  it('hides /btw side chats by their title marker only', () => {
    expect(isSideChat({ title: 'btw · why is the build slow?' })).toBe(true)
    expect(isSideChat({ title: 'btw: notes' })).toBe(false)
    expect(isSideChat({})).toBe(false)
  })

  it('filters supported activity states', () => {
    expect(matchesThreadStatusFilter({ filters: [], running: false, needsAttention: false, archived: false, muted: false })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['working'], running: true, needsAttention: false, archived: false, muted: false })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['working'], running: false, needsAttention: false, archived: false, muted: false })).toBe(false)
    expect(matchesThreadStatusFilter({ filters: ['attention'], running: false, needsAttention: true, archived: false, muted: false })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['archived'], running: false, needsAttention: false, archived: true, muted: false })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['muted'], running: true, needsAttention: false, archived: false, muted: true })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['muted'], running: true, needsAttention: false, archived: false, muted: false })).toBe(false)
    expect(matchesThreadStatusFilter({ filters: ['working', 'attention'], running: false, needsAttention: true, archived: false, muted: false })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['working', 'attention'], running: false, needsAttention: false, archived: false, muted: false })).toBe(false)
  })

  it('filters completed and attention-needed threads but excludes archived and muted threads', () => {
    expect(matchesThreadStatusFilter({ filters: ['not-working'], running: false, needsAttention: false, archived: false, muted: false })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['not-working'], running: true, needsAttention: true, archived: false, muted: false })).toBe(true)
    expect(matchesThreadStatusFilter({ filters: ['not-working'], running: true, needsAttention: false, archived: false, muted: false })).toBe(false)
    expect(matchesThreadStatusFilter({ filters: ['not-working'], running: false, needsAttention: false, archived: true, muted: false })).toBe(false)
    expect(matchesThreadStatusFilter({ filters: ['not-working'], running: false, needsAttention: false, archived: false, muted: true })).toBe(false)
  })

  it('filters main and subagent sources using Host lineage metadata', () => {
    expect(matchesThreadSourceFilter({}, 'main')).toBe(true)
    expect(matchesThreadSourceFilter({ origin: 'subagent' }, 'main')).toBe(false)
    expect(matchesThreadSourceFilter({ parentId: SessionId('parent') }, 'subagents')).toBe(true)
    expect(matchesThreadSourceFilter({ origin: 'subagent' }, 'subagents')).toBe(true)
    expect(matchesThreadSourceFilter({}, 'all')).toBe(true)
  })
})
