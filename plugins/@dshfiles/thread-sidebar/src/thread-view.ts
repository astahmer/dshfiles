import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

export const THREAD_GROUP_BY_OPTIONS = ['project', 'date', 'status', 'none'] as const
export type ThreadGroupBy = (typeof THREAD_GROUP_BY_OPTIONS)[number]

export const THREAD_STATUS_FILTER_OPTIONS = ['all', 'working', 'not-working', 'attention', 'muted', 'archived'] as const
export type ThreadStatusFilter = Exclude<(typeof THREAD_STATUS_FILTER_OPTIONS)[number], 'all'>
export type ThreadStatusFilters = readonly ThreadStatusFilter[]

export const THREAD_SOURCE_FILTER_OPTIONS = ['all', 'main', 'subagents'] as const
export type ThreadSourceFilter = (typeof THREAD_SOURCE_FILTER_OPTIONS)[number]

export type ThreadDateGroup = 'today' | 'yesterday' | 'lastSevenDays' | 'older'

export interface ThreadViewPreferences {
  readonly groupBy: ThreadGroupBy
  readonly statusFilters: ThreadStatusFilters
  readonly sourceFilter: ThreadSourceFilter
}

export interface ThreadViewEntry<Thread extends Pick<SessionSummary, 'updatedAt'>> {
  readonly thread: Thread
  readonly workspaceId: string | undefined
  /** What the thread sorts and dates by; a muted thread keeps the time it had when muted. Defaults to `updatedAt`. */
  readonly activityAt?: number
}

export interface ThreadViewGroup<Thread> {
  readonly key: string
  readonly label: string
  readonly showHeader: boolean
  readonly threads: readonly Thread[]
}

// @dshfiles/btw titles its forks with this prefix; they live in their right-sidebar tab, not in the thread list.
const SIDE_CHAT_TITLE_PREFIX = 'btw · '

const isSideChat = (thread: Pick<SessionSummary, 'title'>): boolean => thread.title?.startsWith(SIDE_CHAT_TITLE_PREFIX) === true

const matchesThreadSourceFilter = (thread: Partial<Pick<SessionSummary, 'origin' | 'parentId'>>, sourceFilter: ThreadSourceFilter): boolean => {
  if (sourceFilter === 'all') return true
  const isSubagent = thread.origin === 'subagent' || thread.parentId !== undefined
  return sourceFilter === 'subagents' ? isSubagent : !isSubagent
}

const matchesThreadStatusFilter = (options: {
  readonly filters: ThreadStatusFilters
  readonly running: boolean
  readonly needsAttention: boolean
  readonly archived: boolean
  readonly muted: boolean
}): boolean => {
  if (options.filters.length === 0) return true
  return options.filters.some(filter => {
    if (filter === 'muted') return options.muted
    if (filter === 'working') return options.running
    if (filter === 'not-working') return !options.archived && !options.muted && (!options.running || options.needsAttention)
    if (filter === 'attention') return options.needsAttention
    return options.archived
  })
}

const threadDateGroup = (updatedAt: number, now: number): ThreadDateGroup => {
  if (!Number.isFinite(updatedAt)) return 'older'
  const date = new Date(updatedAt)
  const today = new Date(now)
  const activityDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const yesterdayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime()
  const lastSevenDaysStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6).getTime()
  if (activityDay === todayStart) return 'today'
  if (activityDay === yesterdayStart) return 'yesterday'
  if (activityDay >= lastSevenDaysStart) return 'lastSevenDays'
  return 'older'
}

const groupThreadEntries = <Thread extends Pick<SessionSummary, 'updatedAt'>>(options: {
  readonly groupBy: Exclude<ThreadGroupBy, 'status'>
  readonly entries: readonly ThreadViewEntry<Thread>[]
  readonly workspaceTitles: ReadonlyMap<string, string>
  readonly unassignedTitle: string
  readonly dateTitles: Readonly<Record<ThreadDateGroup, string>>
  readonly now: number
}): readonly ThreadViewGroup<Thread>[] => {
  const groups = new Map<string, { label: string; showHeader: boolean; entries: { thread: Thread; activityAt: number }[] }>()
  for (const entry of options.entries) {
    let key = 'none'
    let label = ''
    let showHeader = false
    if (options.groupBy === 'project') {
      key = `project:${entry.workspaceId ?? ''}`
      label = entry.workspaceId === undefined ? options.unassignedTitle : (options.workspaceTitles.get(entry.workspaceId) ?? entry.workspaceId)
      showHeader = true
    }
    if (options.groupBy === 'date') {
      const dateGroup = threadDateGroup(entry.activityAt ?? entry.thread.updatedAt, options.now)
      key = `date:${dateGroup}`
      label = options.dateTitles[dateGroup]
      showHeader = true
    }
    const group = groups.get(key) ?? { label, showHeader, entries: [] }
    group.entries.push({ thread: entry.thread, activityAt: entry.activityAt ?? entry.thread.updatedAt })
    groups.set(key, group)
  }

  const dateOrder = ['date:today', 'date:yesterday', 'date:lastSevenDays', 'date:older']
  const orderedGroups = [...groups.entries()].sort(([leftKey, left], [rightKey, right]) => {
    if (options.groupBy === 'project') return left.label.localeCompare(right.label)
    if (options.groupBy === 'date') return dateOrder.indexOf(leftKey) - dateOrder.indexOf(rightKey)
    return leftKey.localeCompare(rightKey)
  })

  return orderedGroups.map(([key, group]) => ({
    key,
    label: group.label,
    showHeader: group.showHeader,
    threads: group.entries.sort((left, right) => right.activityAt - left.activityAt).map(entry => entry.thread),
  }))
}

export class ThreadViewModel {
  static readonly isSideChat = isSideChat
  static readonly matchesSourceFilter = matchesThreadSourceFilter
  static readonly matchesStatusFilter = matchesThreadStatusFilter
  static readonly dateGroup = threadDateGroup
  static readonly groupEntries = groupThreadEntries
}
