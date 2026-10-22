import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ThreadAttentionLabel } from './attention-presentation.js'

export const THREAD_GROUP_BY_OPTIONS = ['project', 'date', 'status', 'none'] as const
export type ThreadGroupBy = (typeof THREAD_GROUP_BY_OPTIONS)[number]

export const THREAD_STATUS_FILTER_OPTIONS = ['all', 'working', 'not-working', 'attention', 'muted', 'settled', 'archived'] as const
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

export interface ThreadViewAttentionEntry {
  readonly thread: Partial<Pick<SessionSummary, 'origin' | 'parentId'>>
  readonly attentionLabel: ThreadAttentionLabel | undefined
  /** The Host still holds an unacknowledged finish (or a hand unread mark) for this thread. */
  readonly unread?: boolean
  readonly running: boolean
  readonly archived: boolean
  readonly settled: boolean
  readonly muted: boolean
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
  readonly settled: boolean
  readonly muted: boolean
}): boolean => {
  if (options.filters.length === 0) return true
  return options.filters.some(filter => {
    if (filter === 'muted') return options.muted
    if (filter === 'working') return options.running
    // Settled threads are storage, like archived ones: they belong to the settled section of the unfiltered list,
    // never to a working view that happens to clip running threads out.
    if (filter === 'not-working') return !options.archived && !options.settled && !options.muted && !options.running
    if (filter === 'attention') return options.needsAttention
    if (filter === 'settled') return options.settled
    return options.archived
  })
}

const attentionPriority = {
  threadSidebarInterrupted: 5,
  threadSidebarApprovalNeeded: 4,
  threadSidebarInputNeeded: 4,
  threadSidebarNeedsResume: 3,
  threadSidebarTurnFinished: 1,
} satisfies Record<ThreadAttentionLabel, number>

const mostUrgentAttentionLabel = (labels: readonly (ThreadAttentionLabel | undefined)[]): ThreadAttentionLabel | undefined => {
  let mostUrgent: ThreadAttentionLabel | undefined
  for (const label of labels) {
    if (label === undefined) continue
    if (mostUrgent === undefined || attentionPriority[label] > attentionPriority[mostUrgent]) mostUrgent = label
  }
  return mostUrgent
}

const attentionLabelForView = (input: {
  readonly filters: ThreadStatusFilters
  readonly sourceFilter: ThreadSourceFilter
  readonly entries: readonly ThreadViewAttentionEntry[]
}): ThreadAttentionLabel | undefined => {
  const labels = input.entries.flatMap(entry => {
    if (entry.attentionLabel === undefined || !matchesThreadSourceFilter(entry.thread, input.sourceFilter)) return []
    if (
      !matchesThreadStatusFilter({
        filters: input.filters,
        running: entry.running,
        needsAttention: entry.attentionLabel !== undefined,
        archived: entry.archived,
        settled: entry.settled,
        muted: entry.muted,
      })
    ) {
      return []
    }
    return [entry.attentionLabel]
  })
  return mostUrgentAttentionLabel(labels)
}

/** How many threads the view lists that still hold an unacknowledged finish on the Host. */
const unreadCountForView = (input: {
  readonly filters: ThreadStatusFilters
  readonly sourceFilter: ThreadSourceFilter
  readonly entries: readonly ThreadViewAttentionEntry[]
}): number => {
  let count = 0
  for (const entry of input.entries) {
    if (entry.unread !== true || !matchesThreadSourceFilter(entry.thread, input.sourceFilter)) continue
    if (entry.muted && !input.filters.includes('muted')) continue
    if (
      !matchesThreadStatusFilter({
        filters: input.filters,
        running: entry.running,
        needsAttention: entry.attentionLabel !== undefined,
        archived: entry.archived,
        settled: entry.settled,
        muted: entry.muted,
      })
    ) {
      continue
    }
    count += 1
  }
  return count
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
  static readonly mostUrgentAttentionLabel = mostUrgentAttentionLabel
  static readonly attentionLabelForView = attentionLabelForView
  static readonly unreadCountForView = unreadCountForView
  static readonly dateGroup = threadDateGroup
  static readonly groupEntries = groupThreadEntries
}
