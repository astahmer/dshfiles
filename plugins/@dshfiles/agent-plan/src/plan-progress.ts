/** Pure model of an agent's todo plan over time: step N of M and per-step timing from successive `todo/write` events. */

import { Wire } from './wire.js'

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanItem {
  readonly content: string
  readonly status: PlanStatus
}

/** One durable `todo/write` snapshot: the whole list the agent wrote, when, and in which turn. */
export interface PlanWrite {
  readonly seq: number
  readonly time: number
  readonly turn: number | undefined
  readonly todos: readonly PlanItem[]
}

export interface PlanStep {
  readonly content: string
  readonly status: PlanStatus
  /** First write that showed the step in progress; for a step that jumped straight to done, the write before that. */
  readonly startedAt: number | undefined
  /** First write that showed the step completed. */
  readonly completedAt: number | undefined
}

export interface PlanProgress {
  readonly steps: readonly PlanStep[]
  readonly total: number
  readonly completed: number
  /** 1-based position of the first in-progress step, else of the next pending one; undefined when all are done. */
  readonly current: number | undefined
  /** The step `current` points at. */
  readonly currentStep: PlanStep | undefined
  readonly done: boolean
}

const RANK = { pending: 0, in_progress: 1, completed: 2 } satisfies Readonly<Record<PlanStatus, number>>

/** One todo as the model sent it; each field stays unparsed until read. */
interface TodoData {
  readonly content?: unknown
  readonly status?: unknown
}

/** The three statuses the todo tool accepts. */
const isPlanStatus = (value: unknown): value is PlanStatus => value === 'pending' || value === 'in_progress' || value === 'completed'

/** Read a model-supplied list (call args or an event payload) without trusting its shape. */
const parseItems = (value: unknown): readonly PlanItem[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const items: PlanItem[] = []
  for (const candidate of value) {
    const todo: TodoData | undefined = Wire.isObject(candidate) ? candidate : undefined
    if (todo === undefined) return undefined
    const content = Wire.readString(todo.content)
    if (content === undefined || content.trim() === '' || !isPlanStatus(todo.status)) return undefined
    items.push({ content: content.trim(), status: todo.status })
  }
  return items
}

const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export const PlanProgress = {
  itemsOf: parseItems,
  formatDuration,

  /** `todos` from a `todo_write` call's raw JSON arguments, or undefined while incomplete or invalid. */
  itemsFromArguments(argsRaw: string | undefined): readonly PlanItem[] | undefined {
    if (argsRaw === undefined) return undefined
    try {
      const parsed: unknown = JSON.parse(argsRaw)
      return Wire.isObject(parsed) && 'todos' in parsed ? parseItems(parsed.todos) : undefined
    } catch {
      return undefined
    }
  },

  /**
   * The writes that led to `writes[index]`, oldest first: walk back while each earlier write shares a step with the one
   * after it and no shared step moves backwards (done or in progress, then pending again). A plan rewritten across turns
   * ("continue") keeps its timing; a new plan, or the same plan started over, starts fresh.
   */
  lineage(writes: readonly PlanWrite[], index: number): readonly PlanWrite[] {
    const own = writes[index]
    if (own === undefined) return []
    const chain = [own]
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const earlier = writes[cursor]
      const later = chain[0]
      if (earlier === undefined || later === undefined) break
      const laterStatus = new Map(later.todos.map(todo => [todo.content, RANK[todo.status]]))
      const shared = earlier.todos.filter(todo => laterStatus.has(todo.content))
      if (shared.length === 0 || shared.some(todo => RANK[todo.status] > (laterStatus.get(todo.content) ?? 0))) break
      chain.unshift(earlier)
    }
    return chain
  },

  /**
   * Fold successive writes into steps with timing. `items` is the list being shown (the call's own arguments, or the
   * latest write); `history` supplies when each step started and finished.
   */
  progress(items: readonly PlanItem[], history: readonly PlanWrite[]): PlanProgress {
    const statusByWrite = history.map(write => {
      const statuses = new Map<string, PlanStatus>()
      for (const todo of write.todos) if (!statuses.has(todo.content)) statuses.set(todo.content, todo.status)
      return { time: write.time, statuses }
    })
    const steps = items.map((item): PlanStep => {
      let startedAt: number | undefined
      let completedAt: number | undefined
      let previousTime: number | undefined
      for (const write of statusByWrite) {
        const status = write.statuses.get(item.content)
        if (status === 'in_progress' && startedAt === undefined) startedAt = write.time
        if (status === 'completed' && completedAt === undefined) {
          completedAt = write.time
          startedAt ??= previousTime
        }
        previousTime = write.time
      }
      return {
        content: item.content,
        status: item.status,
        startedAt: item.status === 'pending' ? undefined : startedAt,
        completedAt: item.status === 'completed' ? completedAt : undefined,
      }
    })
    const completed = steps.filter(step => step.status === 'completed').length
    const activeIndex = steps.findIndex(step => step.status === 'in_progress')
    const nextIndex = activeIndex >= 0 ? activeIndex : steps.findIndex(step => step.status === 'pending')
    return {
      steps,
      total: steps.length,
      completed,
      current: nextIndex >= 0 ? nextIndex + 1 : undefined,
      currentStep: nextIndex >= 0 ? steps[nextIndex] : undefined,
      done: steps.length > 0 && completed === steps.length,
    }
  },

  /** How long a step took, or has been running at `now`; undefined when it never started. */
  elapsed(step: PlanStep, now: number): number | undefined {
    if (step.startedAt === undefined) return undefined
    return (step.completedAt ?? (step.status === 'in_progress' ? now : step.startedAt)) - step.startedAt
  },

  /** "Step 2 of 5", or "5 of 5 done". */
  label(progress: PlanProgress): string {
    if (progress.total === 0) return 'Empty plan'
    if (progress.done) return `${progress.total} of ${progress.total} done`
    return `Step ${progress.current ?? progress.completed + 1} of ${progress.total}`
  },
}
