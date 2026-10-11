import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

export const THREAD_GROUP_BY_OPTIONS = ['project', 'date', 'status', 'none'] as const
export type ThreadGroupBy = (typeof THREAD_GROUP_BY_OPTIONS)[number]

export const THREAD_STATUS_FILTER_OPTIONS = ['all', 'working', 'attention', 'archived'] as const
export type ThreadStatusFilter = (typeof THREAD_STATUS_FILTER_OPTIONS)[number]

export const THREAD_SOURCE_FILTER_OPTIONS = ['all', 'main', 'subagents'] as const
export type ThreadSourceFilter = (typeof THREAD_SOURCE_FILTER_OPTIONS)[number]

export type ThreadDateGroup = 'today' | 'yesterday' | 'lastSevenDays' | 'older'

export interface ThreadViewPreferences {
  readonly groupBy: ThreadGroupBy
  readonly statusFilter: ThreadStatusFilter
  readonly sourceFilter: ThreadSourceFilter
}

export interface ThreadViewEntry<Thread extends Pick<SessionSummary, 'updatedAt'>> {
  readonly thread: Thread
  readonly workspaceId: string | undefined
}

export interface ThreadViewGroup<Thread> {
  readonly key: string
  readonly label: string
  readonly showHeader: boolean
  readonly threads: readonly Thread[]
}

export const matchesThreadSourceFilter = (thread: Partial<Pick<SessionSummary, 'origin' | 'parentId'>>, sourceFilter: ThreadSourceFilter): boolean => {
  if (sourceFilter === 'all') return true
  const isSubagent = thread.origin === 'subagent' || thread.parentId !== undefined
  return sourceFilter === 'subagents' ? isSubagent : !isSubagent
}

export const matchesThreadStatusFilter = (options: {
  readonly filter: ThreadStatusFilter
  readonly running: boolean
  readonly needsAttention: boolean
  readonly archived: boolean
}): boolean => {
  if (options.filter === 'all') return true
  if (options.filter === 'working') return options.running
  if (options.filter === 'attention') return options.needsAttention
  return options.archived
}

export const threadDateGroup = (updatedAt: number, now: number): ThreadDateGroup => {
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

export const groupThreadEntries = <Thread extends Pick<SessionSummary, 'updatedAt'>>(options: {
  readonly groupBy: Exclude<ThreadGroupBy, 'status'>
  readonly entries: readonly ThreadViewEntry<Thread>[]
  readonly workspaceTitles: ReadonlyMap<string, string>
  readonly unassignedTitle: string
  readonly dateTitles: Readonly<Record<ThreadDateGroup, string>>
  readonly now: number
}): readonly ThreadViewGroup<Thread>[] => {
  const groups = new Map<string, { label: string; showHeader: boolean; entries: Thread[] }>()
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
      const dateGroup = threadDateGroup(entry.thread.updatedAt, options.now)
      key = `date:${dateGroup}`
      label = options.dateTitles[dateGroup]
      showHeader = true
    }
    const group = groups.get(key) ?? { label, showHeader, entries: [] }
    group.entries.push(entry.thread)
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
    threads: group.entries.sort((left, right) => right.updatedAt - left.updatedAt),
  }))
}
